# PkgCompass: эксплуатация v1

Дата: 5 октября 2026. По [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](decisions/0014-learning-project-simplifications.md). Приложения и скриптов ещё нет: команды ниже — интерфейс к реализации, их предстоит проверить в чистом checkout.

## 1. Окружения

| Среда | CMS / SQL | CRM / аналитика |
| --- | --- | --- |
| Local / CI / untrusted PR | Synthetic CMS/API fixtures, временный PostgreSQL | Fake adapters, без live secrets |
| Development / trusted preview | Sanity development + Neon development branch | Отдельный Brevo dev list, только выделенный тестовый email-alias владельца, никогда не используемый в production; PostHog dev project |
| Production | Sanity production + Neon production branch | Brevo production requests list, PostHog production EU project |

Development создаётся в первой интеграционной задаче, production — отдельно до release. Development branch — schema-only плюс seed. Тесты не меняют общий live seed конкурентно: namespace и последовательный dev smoke. Обычный PR не получает writer credentials. `APP_ENV` связывает CMS/DB/CRM/analytics targets одной конфигурацией.

SQL migrations одинаковы для local, dev и prod; ветка Neon не заменяет миграции. Регион и параметры подключения фиксирует account setup: web — pooled connection, collector lock и migrations — direct.

## 2. Доступы и bootstrap

Env-контракт — [05 §4](05-architecture.md#4-конфигурация-без-значений), `.env.example` содержит только имена. SQL-роли:

- public reader — SELECT `metrics_current`, без доступа к таблицам заявок;
- collector writer — `metrics_current` и lock, без заявок и без записи в CMS;
- lead writer — `lead_requests` и `rate_limits`;
- migration owner — схема.

GRANT проверяется Q17.

Sanity: preview-read token на сервере, seed-write token только у оператора, `aiReview` меняется редакторской сессией Studio. Custom document roles на бесплатном плане не предполагаются: allowlists и разделение секретов обязательны.

Bootstrap: `npm ci` → env template → local PostgreSQL → migrations → fixtures → app/Studio. Live dev: создать targets, проверить quotas и регион, выполнить migrations, `seed --dry-run`, затем `--apply`; настроить подписанный webhook, Brevo list и custom attributes, PostHog consent-only config и dashboard, Vercel Cron и GitHub dispatch token. `PRIVACY_CONTACT_EMAIL` — реальный контакт владельца до публичной формы. Production origin может быть Vercel URL, домен не обязателен.

## 3. Планируемые команды

| Команда | Результат |
| --- | --- |
| `npm run dev` / `npm run studio` | Local app / Studio |
| `npm run db:migrate -- --env development` | Версионированная схема в выбранном target |
| `npm run seed -- --env development --dry-run` или `--apply` | Отсутствующие CMS drafts, существующие не меняются |
| `npm run collect -- --env development --dry-run` или `--apply` | Текущие метрики и очищенный отчёт, один writer |
| `npm run cache:refresh -- --env development` | Повтор invalidation после сбоя collector |
| `npm run maintenance -- --env development --dry-run` или `--apply` | Удаление заявок старше 30 дней в Brevo и БД, очистка rate limits |
| `npm run backup` / `npm run restore -- --env development` | CMS export / импорт export в выбранный dataset |
| `npm run lint` / `typecheck` / `test` / `build` / `test:e2e` | Проверки по 11 |

Все write-команды принимают явный `--env`; production дополнительно требует `--allow-production`, кроме server handlers конкретного деплоя. Реальный синтаксис появится в README после проверки; таблица не притворяется существующим CLI.

## 4. Расписание и диагностика

Workflows в GitHub Actions запускаются только через `workflow_dispatch`, без `schedule`: GitHub отключает scheduled workflows через 60 дней без активности в публичном репозитории. Раз в день Vercel Cron вызывает `/api/cron/daily`. Handler проверяет `CRON_SECRET` и через GitHub API запускает workflow `daily` для своего окружения. Workflow выполняет две независимые job: сбор метрик с collector credentials и lead maintenance с lead credentials. Нужно ли перед dispatch включать workflow через API, проверяется в FP-04. Ручной запуск — тот же `workflow_dispatch`.

Concurrency `collector-<env>`, `cancel-in-progress = false` и session advisory lock защищают запись метрик; lock нужен и локальному `--apply`. HTTP retries ограничены по 06 и 09.

Отчёты запусков: статусы и ошибки источников, run UUID, counts, duration, статус кеша, без PII. О сбоях Actions владелец узнаёт из стандартных уведомлений аккаунта; отдельные Slack/email-интеграции не создаются. Владелец ежедневно проверяет ошибки, свежесть и заявки в CRM. UI при устаревании показывает исходную дату. Логи приложения и CRM содержат безопасные коды, без email, тела запроса, токенов, IP и полного query.

## 5. Восстановление

| Сбой | Действие |
| --- | --- |
| Source timeout / 429 | Остаётся last-valid с датой, новый сбор после лимита |
| Collector crash / lock busy | Закрыть зависший процесс или connection, если нужно; новый запуск |
| Mapping изменён | Подтвердить связь в CMS, пересобрать; старые данные не смешиваются |
| AI-review устарел или mapping изменился | Новый review в Studio; публикация обновляет страницы через webhook |
| Invalidation failure | `cache:refresh` либо TTL ≤ 3600 s; данные не откатываются |
| CRM-ответ потерян / CRM недоступна | Посетитель повторяет тот же `requestId`; accepted только после успеха |
| Потеря БД | Миграции с нуля, новый сбор метрик; заявки остаются в Brevo |
| Потеря CMS-контента | Импорт последнего CMS export |

Неверное значение метрики исправляется исправлением mapping или источника и новым сбором, который перезапишет строку.

## 6. Retention и backup

- Метрики: только текущее состояние, истории нет.
- Заявки в БД и проектные данные в Brevo: 30 дней по 09. Rate limits: 24 часа.
- События PostHog: 90 дней по 10. Отчёты CI: 14 дней.
- Сырые API payload не архивируются.

Backup — только CMS export: перед изменениями схемы и еженедельно, окно 30 дней, в закрытом хранилище владельца. SQL-бэкап не нужен: метрики восстанавливаются сбором, заявки хранятся в Brevo. Ветка Neon бэкапом не объявляется.

Перед release — rehearsal восстановления:

1. Импорт CMS export в изолированный dataset. Если квота Sanity не позволяет третий dataset — в development после его собственного export.
2. Пустая test DB из migrations.
3. Новый collector run.
4. Smoke публикации и чтения; проверка, что public role не читает заявки.

## 7. Release и расходы

До production: аккаунты, targets, secrets, бюджет и квоты, privacy contact, отключённые кампании CRM, Vercel Cron, real smoke и Q01–Q19. Это задачи реализации, а не открытые продуктовые решения. Платные upgrades требуют отдельного разрешения владельца, автоматических покупок нет. Public demo не запускает рассылку.

После deploy: HTTP smoke home/catalog/product/comparison/form/privacy/methodology/sitemap, отказ guest в draft, свежий статус источников, событие в dashboard при явном consent. Тестовая заявка только с собственным адресом владельца и последующим удалением; чужих контактов не создавать. Откат приложения не откатывает CMS/DB/CRM: миграции обратно совместимы, откат данных — отдельная операторская задача.
