# PkgCompass: заявка → CRM v1

Дата: 5 октября 2026. Обязательный контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](decisions/0014-learning-project-simplifications.md). Это контактная заявка, не подписка; аккаунт CRM ещё не подключён.

## 1. Обещание и интерфейс

`/en/request-shortlist/` — Request a CMS shortlist. Посетитель просит владельца помочь сузить выбор для одного сценария. Помощь бесплатная и некоммерческая, это прямо сказано на странице. Ответ вручную по email; без срока ответа, автоматического письма, рассылки, DOI и подтверждения адреса. Владелец проверяет заявки в CRM ежедневно после запуска; факт оказанной помощи конверсией не считается.

Поля: email (trim, lowercase для ключа и CRM, валидный адрес до 254 символов); `scenario = marketing_site | editorial_site | commerce_content`; обязательный, изначально не отмеченный checkbox «I agree to be contacted about this request»; ссылка на privacy. Свободного текста, имени и телефона нет. Analytics consent независим и для отправки не нужен.

Состояния: `idle → submitting → accepted` либо `retryable_error` / `validation_error` / `rate_limited`. Accepted только после подтверждённой записи в CRM. Текст успеха: «Your request is saved. The project owner may contact you about this request.» При неизвестном результате: «We could not confirm your request. Please retry.» Введённое хранится в памяти вкладки; email не пишется в localStorage, URL и свойства аналитики. Доступные labels, errors и status region обязательны.

## 2. Серверный путь и данные

`POST /api/leads`: JSON, body до 4 KB, проверка Origin, серверная валидация и honeypot.

- Origin в production — только origin `SITE_URL`. В development дополнительно разрешены `https://$VERCEL_URL` и `https://$VERCEL_BRANCH_URL` текущего деплоя. Локально — `SITE_URL` тестового origin.
- Форма создаёт UUID `requestId` и держит его в памяти, пока не изменятся email или scenario либо заявка не станет accepted. Повтор использует тот же ID.
- Rate limit в PostgreSQL: HMAC(IP), 5 запросов за 10 минут, хранение 24 часа; raw IP не сохраняется.
- Honeypot возвращает `{status: accepted, analyticsEligible: false}` без CRM и без конверсии.
- Rate limit и handler не зависят от аналитического consent.

Таблица `lead_requests` без email:

| Поле | Значение |
| --- | --- |
| `request_id` | UUID, PK |
| `dedup_key` | HMAC-SHA256(нормализованный email + scenario) |
| `payload_hash` | HMAC того же payload вместе с `contact_permission_version` |
| `scenario`, `contact_permission_version`, `contact_permission_at` | Контекст и разрешение на контакт |
| `state` | `pending` / `accepted` / `failed` |
| `conversion_id` | UUID, создаётся при вставке строки |
| `created_at`, `updated_at`, `expires_at` | Срок хранения 30 дней от `created_at` |

Частичный unique index по `dedup_key` среди строк `state = accepted`. Тот же `requestId` с другим payload → 409.

Email живёт только в памяти запроса и в Brevo; в PostgreSQL, Sanity, fixtures, логах CI и аналитике его нет. Web lead credential имеет доступ только к `lead_requests` и `rate_limits`; public DB reader — только к `metrics_current`.

## 3. Обработка заявки и CRM

Провайдер — Brevo Contacts API. До реального smoke создать отдельный список PkgCompass requests и custom attributes `PKG_SCENARIO` (text), `PKG_CONTACT_PERMISSION_AT` (text ISO), `PKG_REQUESTED_AT` (date). Adapter `upsert(email, scenario, permissionAt)`: `POST /v3/contacts` с `updateEnabled = true`, `listIds = [проектный список]` и атрибутами. Успех — документированный 2xx; любой 400 успехом не объявляется. Список не подключён к кампаниям; флаги unsubscribe/blocklist существующего контакта не сбрасываются.

Источник API: [Brevo create contact](https://developers.brevo.com/reference/create-contact), [update contact](https://developers.brevo.com/reference/update-contact). Upsert по email устраняет дубли контактов; unique index в БД устраняет дубли конверсий. Это не Sales CRM и не доставка писем.

Порядок:

1. Найти строку по `requestId` или вставить новую в `pending`. Если она уже `accepted` — вернуть тот же `conversionId`. При несовпадении payload — 409.
2. Если другая строка с тем же `dedup_key` уже `accepted` — вернуть нейтральный `{status: accepted, analyticsEligible: false}` без CRM-вызова и без чужого ID.
3. Вызвать Brevo upsert, timeout 10 s; SQL-транзакция во время вызова не открыта.
4. При успехе — условный `UPDATE ... SET state = accepted WHERE state <> accepted`. Если частичный unique index сработал (параллельная заявка того же email и сценария успела раньше), ответ — нейтральный accepted с `analyticsEligible: false`.
5. При ошибке — `state = failed`, ответ 503; клиент повторяет тот же `requestId`.

Конкурентные запросы с одним `requestId` безопасны без lease: оба upsert идемпотентны, переход в `accepted` выполнится один раз, оба ответа получат один `conversionId`. Если ответ CRM потерян, повтор того же `requestId` снова вызывает upsert и завершает операцию. Лимит попыток не нужен: повторы ограничены rate limit. Фоновых очередей и worker'ов нет.

429, 5xx, network и timeout → 503, ответ CRM никогда не превращается в успех. Ошибка конфигурации или авторизации → 503 пользователю и безопасный код в логе. Недоступная БД → 503 без вызова CRM.

## 4. Ответы и измерение

| Ответ | Когда |
| --- | --- |
| `200 {status: accepted, conversionId, analyticsEligible: true}` | Собственный `requestId` дошёл до accepted; повтор возвращает тот же `conversionId` |
| `200 {status: accepted, analyticsEligible: false}` | Дубликат с новым `requestId` или honeypot; ID исходной операции не раскрывается |
| 400 / 409 / 429 / 503 | Невалидно / изменённый payload / rate limit / недоступно |

`requestId` — случайный credential операции; публичного GET по email или `requestId` нет. Браузер не передаёт email и CRM ID в аналитику ([10](10-measurement.md)).

Conversion — одна accepted операция. Повторная сетевая доставка события дедуплицируется по `conversionId`. Успех формы сохраняется даже при блокировщике аналитики; failed, honeypot и чужой дубликат не создают `lead_accepted`. Число accepted строк в БД и число событий аналитики не обязаны совпадать.

## 5. Хранение, удаление, оператор

- Строки `lead_requests` — 30 дней после `created_at`, удаляются ежедневным maintenance.
- В Brevo maintenance читает контакты проектного списка и обрабатывает те, у которых `PKG_REQUESTED_AT` старше 30 дней. Каждая заявка обновляет атрибут, поэтому контакт живёт 30 дней после последней заявки. Если контакт есть только в проектном списке, он удаляется целиком. Если у него есть другие списки, удаляется только членство в проектном списке и атрибуты `PKG_*`.
- Запрос владельца адреса на удаление: оператор удаляет контакт в Brevo по email и строки в БД по HMAC для каждого сценария. Адрес в отчёт не попадает.
- Бэкапа заявок нет: адреса хранятся в Brevo, а таблица в БД — только состояние дедупликации. При потере таблицы миграции создают её заново, в худшем случае возможна одна лишняя конверсия в течение 30 дней.
- Ротация `LEAD_HMAC_SECRET` — замена секрета и очистка `rate_limits`. Старые ключи дедупликации перестают совпадать, последствие то же.

Privacy-страница называет владельца и действующий контакт, цель формы, Brevo и PostgreSQL, срок 30 дней, бесплатный некоммерческий характер помощи, независимость analytics consent и способ запросить удаление. Контакт задаётся `PRIVACY_CONTACT_EMAIL` до публичного запуска, локально — fixture. Согласие на контакт не является согласием на рассылку.

## 6. Приёмка

Валидная заявка видна в реальной CRM; в CI используется fake adapter. Проверить: invalid, checkbox, honeypot, rate limit; успех без consent; конкурентные запросы с одним `requestId`; дубликат с новым ID; CRM timeout и потерянный ответ с повтором; отказ БД без вызова CRM; повтор не создаёт новый контакт и новую конверсию; отсутствие email в БД и логах; удаление по сроку в Brevo и БД; Origin preview-деплоя в development. Подробности — [11](11-quality-plan.md), команды — [12](12-operations.md).
