# PkgCompass

Каталог headless CMS для JS/TS-сайтов. Development-прототип CMS → публичный HTML → форма → Brevo → consented PostHog проверен; результаты и границы — в [итоговой приёмке FP-05](docs/work/journal/2026-10-08-fp05-final.md). Фактическое состояние задач — в [рабочем реестре](docs/work/tasks.md). Полный контент, дизайн, эксплуатация и production release ещё предстоят.

## Начало работы

1. Прочитать [реестр решений](docs/00-start-decisions.md), [продуктовую рамку](docs/02-product-and-scope.md) и [план ядра](docs/14-core-development-plan.md).
2. Выбрать задачу в [рабочем реестре](docs/work/tasks.md), проверить её зависимости и DoD в детальном плане.
3. Создать запись работы: `python3 scripts/worklog.py start FP-01 --summary "Начало каркаса приложения"`.
4. Добавлять результаты проверок и завершить запись по [рабочему процессу](docs/work/README.md).

Для рабочего журнала нужен Python 3.9+ (standard library, macOS/Linux). Проверенные команды приложения приведены ниже. CI относится к QA-01.

## Версии foundation

Stable-версии сверены 5 октября 2026 по официальным документациям и публичным npm metadata. Точные зависимости фиксирует `package-lock.json`; runtime — `.nvmrc` и `package.json`.

| Компонент | Выбор | Причина |
| --- | --- | --- |
| Node / npm | 24.18.0 / 12.0.2 | Доступная локальная пара, удовлетворяет engines выбранных инструментов |
| Next.js / React | 16.3.8 / 19.3.0 | Stable App Router; совместимые peer dependencies |
| TypeScript | 6.0.3 | Latest 7.0.2 выходит за поддерживаемый диапазон typescript-eslint `<6.1.0` |
| Sanity | 6.17.0 | Требует Node ≥22.12 и React 19; подходит выбранному runtime |
| Tailwind | 4.3.3 | PostCSS integration |
| ESLint / Next plugin | 10.12.0 / 16.3.8 | Прямой flat config с TypeScript и React Hooks; bundled React-плагин eslint-config-next несовместим с ESLint 10 |
| Vitest / Vite | 5.0.3 / 8.3.2 | Совместимые Node engines и peers |
| Playwright | 1.63.0 | Браузерные проверки устанавливаются с появлением сценариев |
| node-postgres / local PostgreSQL | 8.23.1 / 17.11 | Drizzle PostgreSQL driver; локальный сервер для временных SQL integration checks |

Источники: [Node releases](https://nodejs.org/en/about/previous-releases), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Sanity requirements](https://www.sanity.io/docs/studio/installation), [typescript-eslint dependencies](https://typescript-eslint.io/users/dependency-versions/), [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro).

## Локальное приложение

```sh
nvm use
npm ci
npm run lint
npm run typecheck
npm run build
npm run start
```

Стартовая страница — `/en/`, `/` перенаправляет на неё. Локально доступны synthetic каталог, CMS detail/comparison и форма; полная live-приёмка и публичный release ещё не завершены. `npm run dev` запускает Next.js для разработки. Для каркаса `.env` и внешние аккаунты не нужны.

`npm run studio` и `npm run studio:build` требуют выделенных `SANITY_STUDIO_PROJECT_ID` и `SANITY_STUDIO_DATASET`. Эти два значения публичные, секретные токены в Studio не передаются. Схемы относятся к CW-02. Проверены build и настоящая Studio UI-публикация synthetic AI-review с automatic webhook; полная редакционная приёмка остаётся в CW/QA.

`npm run test` проверяет foundation config, synthetic fixtures, safe projections и отказные сценарии adapters. Для автономного browser path использовать `PKGCOMPASS_RUN_ID=<RUN-ID> CI=true npm run test:e2e:fixture`: отдельная копия приложения без `.env`, loopback-only browser network, in-memory CRM/DB и intercepted unavailable/lost-response сценарии. Granted SDK/provider lifecycle подтверждён отдельно в development evidence; fixture runtime отключает measurement. Browser traces/screenshots/video отключены, результаты идут в текущий run. Удалённый CI пока не запускался. `next-env.d.ts` создаётся `next typegen` перед проверкой типов и исключён из Git.

## Targets и автономный режим

`APP_ENV` выбирает `fixture`, `development` или `production` для всех компонентов. Локальный запуск без выбранной среды и обычный CI используют fixtures. Явный local `development` предназначен для dev smoke; web config допускает `production` только в Vercel production. Trusted preview требует `development`. PR preview по умолчанию использует fixtures; владелец deployment может явно отметить проверенный preview через `PKGCOMPASS_TRUSTED_PREVIEW=true` в настройках Vercel. Этот флаг не берётся из PR payload. Явный untrusted context сохраняет fixture mode. Provisioning относится к FP-04.

Проверка каждого компонента требует только его настройки; ошибка SQL не скрывает редакционный контент. Неверная live-конфигурация возвращает безопасную ошибку, а незавершённый live adapter — `adapter_unavailable`.

| Компонент | Fixture | Development / production |
| --- | --- | --- |
| CMS | Пять synthetic CMS, нейтральный draft marker, пара и AI-review inputs | `SANITY_PROJECT_ID`, `SANITY_DATASET` (имя совпадает с APP_ENV), `SANITY_API_VERSION` |
| Metrics read | Synthetic npm/GitHub ответы | `DATABASE_READ_URL` |
| Metrics write | Fake writer | `DATABASE_IMPORT_URL` |
| CRM | Fake с счётчиком accepted, без сохранения email | `BREVO_API_KEY`, `BREVO_REQUEST_LIST_ID` |
| Measurement | Stub с явным event/ID allowlist | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (EU) |

Fixtures находятся в `src/server/fixtures/`, порты — в `src/domain/ports.ts`, выбор targets — в `src/server/config/`. Они помечены synthetic и не подтверждают данные поставщиков. Public config возвращает только среду и публичные PostHog key/host. SDK загружается после analytics consent; withdrawal очищает optional storage. Изолированный браузерный smoke проверяет lifecycle без внешней отправки; полная live-приёмка учитывается отдельно.

## Миграционный baseline

FP-03 предоставляет общий Drizzle runner и четыре отдельные SQL-роли. В `migrations/meta/_journal.json` зарегистрированы четыре доменные миграции: текущие метрики, lead/rate-limit схема и точные grants. Bootstrap выполняется аккаунтом, которому разрешено создавать роли; пароли задаются отдельно в secret store. После bootstrap `DATABASE_MIGRATION_URL` должен использовать `pkgcompass_migration_owner`, а не административный аккаунт.

CLI получает настройки из окружения процесса; `.env.local` автоматически читает Next.js, но не эти Node-скрипты. Перед CLI запустить доверенный способ загрузки нужных переменных из secret store. Не передавать секретные URL в аргументах команд.

```sh
npm run db:bootstrap-roles -- --env fixture --dry-run
npm run db:bootstrap-roles -- --env fixture --apply
npm run db:migrate -- --env fixture --dry-run
npm run db:migrate -- --env fixture --apply
```

`fixture` принимает только временный локальный PostgreSQL. Для development явно заменить среду на `--env development` и выбрать dev credentials. `--env` и режим обязательны; `APP_ENV`, если задан, должен совпадать. Для production также обязателен `--allow-production`, включая dry-run. Обработка ошибок выводит безопасный код без URL, SQL detail или credential. Известные Neon pooler hosts не подходят для migrations/collector; connection query допускает только проверенные SSL/channel-binding параметры.

Web metrics reader и lead writer используют `pg.Pool`; migrations и collector — отдельный `pg.Client`, сохраняющий session lock. Runner проверяет порядок и hash применённой истории, сериализует apply и не создаёт историю в dry-run. После доменных миграций проверены положительные и запрещённые SQL-запросы четырёх ролей на свежем локальном PostgreSQL и development Neon; локальные synthetic записи и DDL в role probes откатываются.

TypeScript connection factories в `src/server/db/` используют политику web-конфига. Migration CLI выбирает target отдельно через явный `--env` и CLI guards; collector CLI выбирает target отдельно и сохраняет общий CI fixture boundary; узкий opt-in development workflow_dispatch проверяется отдельным selector. Web factory с настройками по умолчанию в обычном CI не включает live-соединение; подставлять выдуманные Vercel/CI flags для обхода этой границы нельзя.

Интеграционная проверка `npm run test:foundation-db:postgres` требует `DATABASE_TEST_URL` для отдельной loopback-базы `pkgcompass_fp03_review`. Она создаёт только синтетические временные объекты; на live targets её запуск запрещён. Обычный `npm test` без этого target явно пропускает SQL integration cases.

При релизе сначала добавлять совместимую схему, затем код. Удаление или изменение данных — отдельная задача с подготовкой восстановления. Откат приложения не откатывает CMS, CRM или SQL.

## Подключение development сервисов

[Справочник регистраций и ключей](docs/setup/development-services.md) описывает Sanity development dataset, Neon dev branch, Brevo dev list, PostHog EU project и подготовку GitHub/Vercel. В нём разделены публичные identifiers, provider credentials и самостоятельно генерируемые секреты, указаны места хранения и официальные источники условий сервисов.

Публичные условия и авторизованные account Plan/Usage экраны сверены 5 октября 2026; результаты и ограничения — в [development services](docs/setup/development-services.md#проверенные-параметры-аккаунтов). Проверены права четырёх Neon ролей, synthetic seed пяти CMS, Next.js Preview, live API формы/Brevo, consented EU PostHog ingestion и development dispatch. Окно PostHog retention 90 дней, сохранённый analytics report, production расписание и эксплуатация остаются отдельными проверками. Временный webhook access отозван после приёмки; перед регулярной редакторской работой нужен постоянный dev delivery target. Значения ключей сохраняются непосредственно в secret stores; справочник и `.env.example` содержат только имена.

### Проверки dev targets

Локальные проверки требуют явного target; они читают ignored `.env.local` и выводят только безопасные codes/counts. Не запускать их в CI/untrusted PR или на production. API smoke выполняется последовательно в общем dev namespace. Fixture-тесты `npm test` не запускают эти live проверки: их opt-in cases явно skipped.

```sh
npm run dev:check:sanity -- --env development
npm run dev:check:neon -- --env development
npm run dev:check:brevo -- --env development
```

Sanity проверяет aggregate counts с published perspective и preview token, без чтения текстов drafts. Это проверка target/API, не publisher/preview UI или mapping 3–5 CMS. Эта команда Neon выполняет только SELECT identity четырёх ролей; отдельный `node scripts/dev/check-neon-role-privileges.mjs --env development` проверяет реальные права таблиц rollback-only synthetic probes после migrations/GRANT. Brevo read-only smoke проверяет dev requests list и три атрибута.

`npm run dev:check:brevo-contact -- --env development` — отдельная **write**-проверка только с выделенным alias владельца из локальной `FP04_TEST_EMAIL`, который не используется в production. Если контакт уже существует, проверка отказывается его менять. Созданный проверкой контакт проверяется через настоящий adapter upsert/repeat и удаляется с подтверждением очистки. Emails/campaigns не отправляются. Alias не добавлять в tracked файлы, command line, fixture, журнал или reports; после smoke убрать его из локального файла, когда он больше не нужен.

CRM entry point `createCrmContacts` в `src/server/crm/` выбирает fake или Brevo по server config; форма использует `/api/leads/`. Publisher/preview/webhook, collector, собственная development заявка и provider smoke подтверждены раздельными live evidence. Итоговый combined path и эксплуатационные ограничения — в [приёмке FP-05](docs/work/journal/2026-10-08-fp05-final.md); новые live smoke требуют точного development target и безопасной очистки.

## Документы и результаты

| Путь | Назначение |
| --- | --- |
| [docs/README.md](docs/README.md) | Контракты v1 и приоритет решений |
| [docs/14-core-development-plan.md](docs/14-core-development-plan.md) | Порядок исполнения и пять детальных планов |
| [docs/work/tasks.md](docs/work/tasks.md) | Текущие статусы 44 задач |
| [docs/setup/development-services.md](docs/setup/development-services.md) | Регистрации, dev targets, API-ключи, локальные секреты и ограничения сервисов |
| [docs/work/journal/](docs/work/journal/README.md) | Очищенная история работы по дням |
| [artifacts/README.md](artifacts/README.md) | Локальные evidence runs, формат и хранение |
| [AGENTS.md](AGENTS.md) | Инструкции работы для следующих агентов |

`main` — локальная исходная ветка; для задачи создавать ветку `work/<task-id>-<short-name>`. Первый проход выполняется в `work/foundation-first-pass`. GitHub remote и Vercel Preview подключены; внешний artifact storage пока не подключён. Все локальные artifacts/runs исключены из Git; это evidence storage, а не резервная копия приватных заявок.
