# PkgCompass: архитектура, интеграции и стоимость v1

Дата: 5 октября 2026. Актуальная спецификация по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md), до реализации и подключения аккаунтов.

## 1. Стек и границы

Next.js App Router + React + TypeScript strict, Node runtime; Sanity Studio/Content Lake, GROQ/Portable Text; Vercel Hobby; Neon PostgreSQL; TypeScript CLI в GitHub Actions. UI — Tailwind, доступные shadcn-компоненты по необходимости. SQL — Drizzle ORM/drizzle-kit. Проверки — Vitest, Playwright, axe, Lighthouse CI, ESLint/typecheck. Package manager npm; один репозиторий без монорепо-оркестратора. Репозиторий публичный к портфолио-релизу; до этого private допустим, текущая visibility учитывается в CI quotas.

Используем совместимые стабильные версии без canary, фиксируем lockfile в первой задаче прототипа; отсутствие lockfile сейчас не является архитектурной развилкой. Next.js выбран ADR 0007, модель ADR 0009, направление UI ADR 0011; актуальный scope ADR 0013.

| Компонент | Ответственность и владелец |
| --- | --- |
| Sanity | Published editorial content, mapping, aiReview, drafts и redirects; редактор |
| PostgreSQL | Snapshots и private lead_requests/rate_limits в разных таблицах/правах |
| Collector | Метрики/перенос AI-review, один writer; CLI/Actions |
| Public read layer | Published CMS + snapshots по stable IDs/mappingKey, readiness и fallback |
| Preview | Авторизованное серверное чтение drafts, private/no-store |
| Lead handler | Валидация, дедупликация/lease, Brevo adapter; server-only |
| Brevo | Контакт и контекст заявки, без newsletter automation |
| PostHog EU | Consent-only события через типизированный адаптер; без PII/replay |

Сбор источников не выполняется в request страницы. Нет receipts/pointers/ledger/resume/reconciliation и отдельного AI-review handler. CMS публикация aiReview переносится в БД следующим AI-run, UI показывает pending. Подробности — 06/07; lead lease — ограниченный механизм одной CRM-заявки по 09, не общий движок заданий.

## 2. Сервер, UI и кеш

Основной текст, ссылки, метрики с датами, evidence, metadata/JSON-LD доступны в серверном HTML. Клиент — URL-фильтры, выбор сравнения, consent, форма, события. При отказе БД редакционный материал остаётся доступен, метрики объясняют недоступность. При отказе CMS без кеша —503, не ложный 404. Search по небольшому каталогу, без внешнего сервиса.

Public repository использует только published perspective и allowlist projection. Preview требует проверенную редакторскую сессию, HttpOnly/Secure/SameSite cookie TTL 1h, no-store/noindex, отдельный серверный draft-read token. Вход через Sanity Presentation credential, разрешённый относительный path; внешний/open redirect запрещён. draftMode cookie без проверки редактора не является авторизацией.

Кеш явно: TTL 3600s; после успешного webhook новая публикация видна при повторном запросе ≤60s, проверяется прототипом. Снятие публикации/rename — немедленное истечение, метрики допускают ограниченный SWR. Конкретный supported API выбирается для pinned Next.js. Метаданные/ссылки/SEO получают тот же readiness, что страницы; CMS CDN не должен возвращать старое состояние после invalidation.

POST /api/revalidate: raw-body signature Sanity, size limit, schema/environment/dataset/type allowlist; теги вычисляет сервер. 401 signature, 400 payload, 503 temporary, 200 success/repeat. library/content → карточка/категория/сравнения; page/settings → соответствующие страницы/оболочка; redirect →старый/новый URL+sitemap; aiReview →карточка/сравнения. Повтор инвалидирует актуальное состояние, не публикует payload события.

POST /api/import-revalidate: отдельный server secret, environment проверка, allowlist product IDs, теги snapshots/catalog/comparisons. Отказ отражается в отчёте, CLI может повторить invalidation; отдельная durable очередь не нужна, TTL ограничивает задержку. Секреты не в query.

## 3. Окружения и подключения

Сразу development CMS dataset и Neon branch для live прототипа, production targets только для релиза. Local/CI — fixtures и локальный/временный PostgreSQL. Trusted preview →development, untrusted PR →fixtures без secrets. Реальные CRM/analytics development проекты/списки отделены от production; подробности 12. Не создаём миграционный этап A → B.

Web Next.js использует pooled connection для SQL; collector lock и migrations — direct session connection. DB roles: public snapshot reader, collector snapshot writer, lead_requests/rate_limits writer, migration owner. AI-review DB role отсутствует; Studio использует редакторскую сессию Sanity, seed — отдельный writer, preview — draft reader. Полные custom roles Sanity не предполагаются; импорт имеет доступ к БД, не editorial CMS writer.

## 4. Конфигурация без значений

| Переменная | Использование |
| --- | --- |
| SITE_URL, APP_ENV, PRIVACY_CONTACT_EMAIL | Origin/target/privacy; локально test origin, production origin до release |
| SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_VERSION | Public/CLI config; API date pinned при init |
| SANITY_STUDIO_PROJECT_ID, SANITY_STUDIO_DATASET | Studio target |
| SANITY_PREVIEW_READ_TOKEN, SANITY_SEED_WRITE_TOKEN | Server preview / operator seed, раздельно |
| SANITY_WEBHOOK_SECRET, PREVIEW_SESSION_SECRET | Проверка webhook и preview session |
| DATABASE_READ_URL | Pooled snapshot read-only web |
| DATABASE_IMPORT_URL | Direct collector snapshot writer и lock |
| DATABASE_LEAD_URL | Pooled web lead writer; direct operator connection при необходимости |
| DATABASE_MIGRATION_URL | Direct migrations/backup operator |
| IMPORT_INVALIDATION_SECRET, GITHUB_API_TOKEN | CLI invalidation / API |
| BREVO_API_KEY, BREVO_REQUEST_LIST_ID | Server CRM adapter |
| LEAD_HMAC_SECRET | Server private dedup/rate-limit; одинаковый у server/operator, ротация с очисткой ключей |
| NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST | Public project key/EU ingestion host, SDK только после consent |

Server secrets не попадают в bundle, logs, Sanity или PR fixtures. Supporting tools/имена приняты как реализационные defaults; никаких отдельных согласований для старта не нужно. Account API host/list ID/version — результат настройки прототипа.

## 5. Стоимость эксплуатации и ограничения

Сохраняются Vercel Hobby/Sanity Free по ADR 0003 для личного некоммерческого проекта. Их нулевая база не означает бесплатность Neon/Brevo/PostHog/backup. Точные квоты текущих аккаунтов, регион, допустимость использования и бюджет проверяются перед live-настройкой; автоматические платные upgrades не включаем. Начинаем с доступных бесплатных планов; если account feature недоступна, прототип фиксирует факт, реализация использует разрешённый эквивалент в том же контракте без обещания бесплатности. При необходимости платного плана — конкретная отдельная approval перед расходом.

Официальные источники проверки: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Sanity pricing](https://www.sanity.io/pricing), [Neon plans](https://neon.com/pricing), [Brevo](https://www.brevo.com/pricing/), [PostHog](https://posthog.com/pricing), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Домена ещё нет; временный production Vercel origin достаточен, покупка не блокирует реализацию/релиз.

Лимиты нагрузки: 5–8 продуктов, daily metrics/weekly AI, 30-day snapshots, один редактор. History caps/retention/CI duration сверяем по прототипу. Количество просмотров не обещаем и не используем как доказательство бесплатности.

## 6. Структура репозитория

src/app — маршруты/metadata/handlers; src/features/catalog/content/leads/measurement — UI; src/domain — ID/валидация/формула; src/server/sanity/db/crm/security — server adapters; studio — schemas/actions; scripts — seed/collect/maintenance; migrations — SQL; tests/fixtures — synthetic data. Это целевые пути, не существующий код. Чистый domain не импортирует SDK/Next.js/secrets.

## 7. Оценка реализации

Предыдущие 84–140h относятся к заменённому scope с расширенным pipeline. Новая оценка ниже — планировочная гипотеза для одного React/TS-разработчика, не доказанная экономия и не обещание 3–5 дней. Учитывает редактуру и проверки; обучение/дизайн сверх указанного объёма увеличат срок.

| Работа | Часы |
| --- | --- |
| Setup, совместимость и сквозной прототип CMS/DB/CRM/analytics | 10–16 |
| Studio, ручной AI-review, ограниченный collector | 8–14 |
| UI, страницы, preview/cache и SEO | 14–22 |
| Контент 5–8 CMS и 3–5 сравнений | 10–18 |
| Форма, CRM, consent, события и dashboard | 10–16 |
| Критические проверки, performance, restore, release и кейс | 12–20 |
| Всего | 64–106 |

Работы в строках не дублируют прототип: строки 2–6 — доведение после него. После первого сквозного прототипа обязательный пересчёт по фактическим затратам/ограничениям. Срезы сокращения времени: остаёмся на пяти CMS и трёх сравнениях, упрощаем визуальные детали; CMS/SEO/форма/измерение и защита данных сохраняются.
