# PkgCompass: эксплуатация v1

Дата: 5 октября 2026. По [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). Приложения/скриптов ещё нет: команды ниже — интерфейс к реализации, их предстоит проверить в чистом checkout.

## 1. Окружения без перехода A → B

| Среда | CMS/SQL | CRM/аналитика |
| --- | --- | --- |
| Local/CI/untrusted PR | Synthetic CMS/API fixtures, временный PostgreSQL | Fake adapters, без live secrets |
| Development/trusted preview | Sanity development + Neon development branch | Отдельный Brevo dev list, только выделенный тестовый email-alias владельца, никогда не используемый в production; PostHog dev project |
| Production | Sanity production + Neon production branch | Brevo production requests list, PostHog production EU project |

Создать development в первой интеграционной задаче; production отдельно до release. Development branch schema-only/seed, не копия private production leads. Тесты не меняют общий live seed конкурентно: namespace и последовательный dev smoke. Обычный PR не получает writer credentials. Production не используется для экспериментов; изменение APP_ENV связывает CMS/DB/CRM/analytics targets одной конфигурацией.

Backup SQL migrations одинаковы для local/dev/prod; ветка Neon не заменяет migrations. Regions и connection settings фиксирует account setup; web pooled, collector advisory lock/migrations direct. Нет обязательного отдельного процесса миграции окружений.

## 2. Доступы и bootstrap

Env-контракт — [05 §4](05-architecture.md#4-конфигурация-без-значений). .env.example только с именами. Public database reader имеет SELECT snapshots, не lead tables. Collector writer имеет snapshots/lock, не leads и не CMS writes. Lead writer — lead_requests/rate_limits; migration owner — schema/backup. SQL GRANT проверяется Q17.

Sanity: preview-read token на сервере, seed-write token только оператору; редакторская Studio session меняет aiReview. SANITY_REVIEW_WRITE_TOKEN/DATABASE_REVIEW_URL не используются. На бесплатном CMS не предполагаем custom document roles: allowlists и secret separation остаются обязательны.

Bootstrap: npm ci → env template → local PostgreSQL → migrations → fixtures → app/Studio. Live dev: создать targets, проверить quotas/region, запустить migrations/seed --dry-run, apply, настроить подписанный webhook, Brevo list/custom attributes, PostHog consent-only config и dashboard. PRIVACY_CONTACT_EMAIL — реальный контакт владельца до публичной формы. Production origin может быть Vercel URL, домен не обязателен.

## 3. Планируемые команды

| Команда | Результат |
| --- | --- |
| npm run dev / npm run studio | Local app / Studio |
| npm run db:migrate -- --env development | Версионированная схема в выбранном target |
| npm run seed -- --env development --dry-run или --apply | Отсутствующие CMS drafts, существующие не меняются |
| npm run collect -- --env development --mode metrics или ai --dry-run/--apply | Снимки и очищенный отчёт, один writer |
| npm run cache:refresh -- --env development | Повтор invalidation после collector failure |
| npm run leads:retry -- --env development --request-id UUID | Операторский повтор после исправления CRM, с lease/attempt guard |
| npm run maintenance -- --env development --dry-run/--apply | Snapshot cleanup и private lead TTL/delete |
| npm run backup / npm run restore -- --env development | Очищенный CMS export, snapshot SQL и отдельный encrypted lead backup |
| npm run lint / typecheck / test / build / test:e2e | Проверки по 11 |

Все write commands принимают явный --env; production дополнительно --allow-production, кроме deploy-targeted server handler. Leads retry request credential не печатается в public logs. Реальные синтаксис/скрипты в README после проверки; текущая таблица не притворяется существующим CLI.

## 4. Расписание и диагностика

Actions workflow_dispatch + daily metrics, weekly AI, daily maintenance. concurrency collector-<env>, cancel-in-progress=false и session advisory lock защищают snapshot writes/cleanup; DB lock нужен и локальному apply. Lead TTL применяется отдельным maintenance шагом со своими credentials/lease, не теми же snapshot правами. HTTP retries ограничены по 06/09.

Отчёты run: source statuses/errors, run UUID, counts/duration/cache status, no PII. Actions failure notification владельцу через стандартные account notifications, не Slack/email send integration. Владелец проверяет ошибки/свежесть и CRM requests ежедневно. Stale в UI показывает исходную дату. Логи app/CRM содержат safe status codes, не email, request body, tokens, IP и полный query.

## 5. Восстановление

| Сбой | Действие |
| --- | --- |
| Source timeout/429 | Старый last-valid с датой, новый сбор после лимита |
| Collector crash/lock busy | Закрыть зависший процесс/connection если требуется; новый run, без resume |
| Mapping изменён | Подтвердить связь в CMS, пересобрать; старые данные не смешиваются |
| Review изменён | UI pending, ручной AI-run переносит published review |
| Invalidation failure | cache:refresh либо TTL ≤3600s; данные не откатываются |
| CRM response потерян/lease expired | Повтор того же requestId/upsert; accepted только после success |
| CRM config/attempt cap | Исправить credential/schema, операторский leads:retry |
| Backup/restore | Восстановить контент/схему/lead state в изоляции; пересобрать missing metrics |

Неверный snapshot исправляется удалением точного ID после backup с операторским отчётом и новым сбором. Нет инфраструктуры exclusions/reconciliation. Restore проверяет stable IDs и matching mappingKey на sample, не выполняет распределённый transactional replay.

## 6. Retention и backup

Snapshots: 30 дней, pinned last-valid/latest/last-complete сохраняются. CI reports:14 дней. Private lead rows и project CRM data:30 дней по 09; rate limits:24h. PostHog events:90 дней по 10. Сырые API payload не архивируем постоянно.

Перед schema/cleanup изменениями CMS export и SQL backup snapshots; еженедельный content/snapshot backup с окном 30 дней. Private lead state — daily encrypted backup с окном 7 дней в закрытом operator storage, ключ отдельно, не public CI artifacts. Доступ и стоимость backup проверяются account setup; pg_dump/external encrypted file — реализационный путь, branch не объявляется backup. Snapshots не содержат PII; lead backup сохраняет dedup state/leases и permission, но не rate-limit историю. Во время restore handlers/collectors выключены, истёкшие lease сбрасываются, expired lead/CRM data удаляются до включения.

Перед release rehearsal: CMS export →development namespace + SQL restore в test DB →publication/read smoke + fake CRM replay/deletion →новый collector run. Сверить IDs/mapping и last-valid, убедиться, что public role не читает leads. Потерянная история метрик допускает новый сбор; потеря принятых private requests без backup не принимается.

## 7. Release и расходы

До production настройка аккаунтов/targets/secrets, account budget и quotas, privacy contact, отключённые CRM campaigns, real smoke и Q01–Q19. Это реализуемые задачи, не открытые продуктовые решения. Платные upgrades требуют отдельного разрешения владельца, автоматических покупок нет. Public demo не запускает рассылку.

После deploy: home/catalog/CMS/comparison/form/privacy/methodology/sitemap HTTP smoke, draft denial, fresh source status, dashboard event при явном consent. Synthetic lead только с собственным адресом владельца и удалением; чужих контактов не создавать. Откат приложения не откатывает CMS/DB/CRM: schema migrations backward-compatible, data rollback отдельной операторской задачей.
