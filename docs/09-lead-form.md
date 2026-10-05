# PkgCompass: заявка → CRM v1

Дата: 5 октября 2026. Обязательный контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). Это контактная заявка, не подписка; аккаунт CRM ещё не подключён.

## 1. Обещание и интерфейс

/en/request-shortlist/ — Request a CMS shortlist. Посетитель просит владельца помочь сузить выбор для одного сценария. Ответ вручную по email; без SLA, автоматического письма, периодической рассылки, DOI и подтверждённого статуса адреса. Владелец проверяет заявки в CRM ежедневно после запуска; факт выполнения помощи не является конверсией.

Поля: email (trim, lowercase для ключа/CRM, валидный адрес до 254 символов), scenario=marketing_site|editorial_site|commerce_content; обязательный unchecked checkbox «I agree to be contacted about this request»; ссылка на privacy. Свободного текста/имени/телефона нет. Analytics consent независим и не нужен для отправки.

Состояния: idle → submitting → accepted либо retryable_error/validation_error/rate_limited. Accepted только после подтверждения записи CRM. Текст success: «Your request is saved. The project owner may contact you about this request.» При неизвестном результате: «We could not confirm your request. Please retry.» Сохраняем введённое в памяти вкладки; email не пишется в localStorage, URL или аналитические свойства. Доступные labels, errors и status region обязательны.

## 2. Серверный путь и данные

POST /api/leads, same-origin JSON, body ≤4KB, Origin проверяется против SITE_URL, server validation и honeypot. Form создаёт requestId UUID и сохраняет его в памяти до изменения email/scenario или accepted; повтор использует тот же ID. Rate limit в PostgreSQL: HMAC(IP) 5 запросов/10 минут, TTL 24h; raw IP не сохраняется. Honeypot возвращает {status:accepted, analyticsEligible:false} без CRM/конверсии. Rate limit и серверный handler не зависят от аналитического consent.

Таблица lead_requests: requestId UUID PK, dedupKey unique (HMAC-SHA256(normalized email + scenario)), payloadHash (тот же HMAC с contactPermissionVersion), email, scenario, contactPermissionVersion=1, contactPermissionAt, createdAt, updatedAt, state=pending|accepted|failed, deliveryAttempts, leaseToken UUID?, crmContactId?, conversionId UUID, leaseUntil?, safeErrorCode?, expiresAt. dedupKey уникален в пределах retained rows (30 дней). Повтор ID с другим payload →409; повтор email+scenario за 30 дней возвращает прежнюю операцию без новой заявки/конверсии. Другой scenario — отдельная заявка, CRM-контакт общий. После удаления TTL новая заявка допустима.

email — private operational data в PostgreSQL/Brevo, никогда в Sanity, fixtures/CI logs/analytics. SQL schema мигрируется вместе со snapshots. Web lead credential имеет доступ только к lead_requests/rate_limits, public DB-reader — только к snapshots. Оператор CLI использует lead-write credential для ручного retry/delete; не collector.

## 3. CRM adapter и отказы

Провайдер Brevo Contacts API. До реального smoke создать отдельный список PkgCompass requests и custom attributes PKG_SCENARIO (text), PKG_CONTACT_PERMISSION_AT (text ISO), PKG_REQUEST_ID (text). Adapter upsert(email, scenario, permissionAt, requestId): POST /v3/contacts с updateEnabled=true, listIds=[выделенный список], attributes; success — documented 2xx, duplicate — проверить контакт/обновить в соответствии с API, не объявлять любой 400 успехом. Общий contact может иметь последнее scenario; все отдельные retained requests остаются в private DB. Список не подключён к campaign automation. Не сбрасываем unsubscribe/blocklist flags существующего контакта и не включаем рассылки.

Источник API: [Brevo create contact](https://developers.brevo.com/reference/create-contact), [update contact](https://developers.brevo.com/reference/update-contact). Upsert устраняет дубли контактов; уникальные ключи БД отдельно устраняют дубли операций. Это не Sales CRM deals/tasks и не доставка письма.

Короткая транзакция создаёт/находит request и выдаёт delivery lease 30s условным UPDATE; сеть вызывается после commit. Каждый lease имеет отдельный leaseToken; запись failed/accepted допускается только условно по своему token, accepted терминален и не откатывается поздней ошибкой. CRM-call не держит SQL transaction. Конкурентный повтор активной lease →202 pending с Retry-After, без нового CRM-call; клиент не polling бесконечно, предлагает повтор через указанное время. CRM timeout 10s; на один HTTP submit один CRM-call, без скрытой очереди. Accepted state и conversionId сохраняются после success, ответ 200. Если CRM ответ/DB commit потерян, lease истекает; повтор upsert по тому же email безопасен и завершает ту же операцию. Без автоматического resume/worker/outbox.

429/5xx/network →failed +503 (429 сервиса не превращается в успех); клиент повторяет тот же requestId. Permanent auth/config/schema error →failed +503 пользователю и safeErrorCode оператору; не выдаём детали CRM. До 3 delivery attempts на операцию; далее только оператор после исправления сбрасывает лимит и повторяет. При недоступной DB →503, CRM не вызывается. При pending от другого requestId с тем же dedupKey не раскрываем прежний ID/статус контакта: даём нейтральный accepted при уже принятой заявке или retryable_error; conversionId для чужого requestId не возвращаем. Это не публичный lookup email.

## 4. Ответы и измерение

200 accepted: {status:accepted, conversionId, analyticsEligible:true} только для requestId, владеющего созданной операцией; повтор того же requestId возвращает тот же conversionId. Дубликат с новым ID →{status:accepted, analyticsEligible:false}, без ID исходной операции. 202 pending только для собственного requestId; 400 invalid; 409 changed payload; 429 rate limit; 503 unavailable. RequestId — случайный credential операции: никакого публичного GET по email/requestId. Браузер не передаёт email/CRM ID в 10.

Conversion = одна уникальная accepted operation. Сеть может доставить событие повторно: аналитический запрос дедуплицирует conversionId. Успех формы сохраняется даже при блокировщике аналитики; failed/pending, honeypot и чужой duplicate не создают lead_accepted. Адрес не подтверждён; операционные lead counts не равны consented analytics counts.

## 5. Хранение, удаление, оператор

Private lead rows — 30 дней после createdAt; общий CRM-contact/PKG_* attributes сохраняются до истечения последней retained заявки этого email, затем очищаются; backup private lead state шифруется и живёт 7 дней. Ежедневный maintenance сначала удаляет принадлежащий только проекту CRM-contact, затем DB row; при сбое сохраняет row для повторного удаления. Если контакт имеет другие списки/назначение, удаляет только membership проекта и его PKG_* attributes, не чужой контакт. При другой retained request на этот email не удаляем контакт/list membership и обновляем PKG_* attributes по последней retained заявке, без новой конверсии. Удаление requests оператором по запросу владельца адреса проходит тот же путь; адрес не печатается в отчёте. Восстановление backup требует повторного удаления expired rows до запуска handler.

Privacy page перечисляет владельца и действующий контакт для обращения, цель формы, Brevo/PostgreSQL, срок 30 дней, независимость analytics consent и способ запросить удаление. Контакт владельца задаётся PRIVACY_CONTACT_EMAIL до публичного запуска; локально fixture. Согласие на контакт не объявляется разрешением на newsletter. Никакая реальная рассылка этим документом не авторизована.

## 6. Приёмка

Валидная заявка видна в реальной CRM; fake adapter используется в CI. Проверить invalid/checkbox/honeypot/rate limit; no-consent success; concurrent duplicate; CRM timeout и потерянный success response; retry после lease; attempt cap/operator retry; DB failure без CRM-call; повтор не создаёт новый контакт/конверсию; deletion/TTL и private data isolation. Подробности — [11](11-quality-plan.md), операционные команды — [12](12-operations.md).
