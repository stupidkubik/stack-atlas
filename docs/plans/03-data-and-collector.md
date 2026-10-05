# План ядра данных и collector PkgCompass

Дата: 5 октября 2026. Статус: план реализации по контрактам v1 с упрощениями [ADR 0014](../decisions/0014-learning-project-simplifications.md). Документ не описывает существующий код и не меняет продуктовые решения.

## Границы и источники правил

План охватывает SQL-схему текущих метрик, чтение подтверждённого mapping из Sanity, seed, сбор метрик, read model с fallback, чтение опубликованного AI-review и ежедневный запуск. Sanity остаётся владельцем редакционных документов, mapping и `aiReview`. PostgreSQL в этом потоке хранит только `metrics_current`; заявки — отдельная область по 09 и плану LM. Seed не редактирует существующие документы. Collector не меняет редакционные поля и не запускается из запроса страницы.

Нормативные контракты: [04](../04-content-model.md), [05](../05-architecture.md), [06](../06-data-pipeline.md), [07](../07-ai-readiness.md), [11](../11-quality-plan.md), [12](../12-operations.md). Пути ниже — **предложенные**; файлы и команды предстоит создать.

Основа — FP-01 (bootstrap), FP-02 (config/adapters/fixtures), FP-03 (migrations/roles). Порядок: `FP-01 → FP-02 → FP-03 первый проход → DP-01 → DP-02 → FP-04 → DP-03 → DP-04 → DP-05 → DP-06`. DP-07 зависит только от DP-01 и DP-03 и может идти параллельно DP-05. CW-05 владеет route handler инвалидации; этот план подключает к нему клиент collector и `cache:refresh`. DP-04 — единственный seed CLI.

## Задачи

### DP-01 — Доменные контракты метрик и mappingKey

**Входы:** FP-01, FP-02; 04 §1–2, 06 §2–5, 07 §1–3.

1. Описать runtime-валидацию опубликованного mapping, наблюдения метрики, строки `metrics_current` и `aiReview`. Валидация различает `0`, `null`, `unknown`, `error` и `not_applicable`, требует UTC timestamps и отвергает даты больше чем на 5 минут в будущем.
2. Реализовать mappingKey в чистом domain-коде: канонический JSON с явным порядком ключей, UTF-8, SHA-256. В ключ входят `productId`, ID и точные внешние имена выбранных package/repository и версия SDK для AI-review. Редакционный текст, slug и displayName не входят.
3. Для пар использовать общий helper `pairKey` из CW, не дублировать его.
4. Подготовить synthetic fixtures: обычный и scoped пакет, monorepo с несколькими SDK, CMS без SDK, rename внешнего имени, смена mapping, ноль и неизвестное значение, неполное npm-окно; для AI — complete, incomplete, not_applicable и несовпадающий mapping.

**Артефакты:** `src/domain/data-contracts.ts`, `src/domain/mapping-key.ts`, `tests/fixtures/data/`.

**DoD:** одна семантическая mapping даёт один ключ независимо от порядка полей; смена package/repository или версии SDK меняет ключ, редакционная правка — нет; Studio, collector и read layer используют один helper; `unknown` и `error` не превращаются в отрицательное доказательство. Q08, Q11.

### DP-02 — SQL-миграции текущих метрик и права таблиц

**Входы:** первый проход FP-03, DP-01; 06 §2, 12 §2. GRANT применяются во втором проходе FP-03.

1. Создать Drizzle-миграцию `metrics_current` по 06 §2: ключ `(product_id, source, metric)`, колонки идентичности источника, последней попытки и последнего валидного значения, `valid_series` JSONB, `run_id`, `updated_at`. FK на Sanity нет.
2. Права: public reader — SELECT `metrics_current`; collector writer — SELECT/INSERT/UPDATE `metrics_current`; ни одна из этих ролей не видит заявки; migration owner — DDL.
3. Проверить миграции на пустой локальной и CI БД, после FP-04 — на development target той же командой из 12.

**Артефакты:** `migrations/`, `src/server/db/schema.ts`, `src/server/db/queries/metrics.ts`.

**DoD:** таблица соответствует 06; роли проверены положительным и запрещённым запросом на реальном PostgreSQL; миграция запускается штатным `db:migrate`. Q08, Q09, Q17.

### DP-03 — Чтение и проверка опубликованного mapping из Sanity

**Входы:** DP-01, FP-02, FP-04 для live target; схемы CW-02. Fixture adapter можно сделать до FP-04.

1. Read-only adapter для опубликованных `product`, `package`, `repository` и `aiReview`; только published perspective, draft не считается текущим mapping или review.
2. Свести `_id`/`_ref` к domain IDs; проверить, что primary package/repository входят в списки, npm-имя и идентичность репозитория однозначны, ссылки опубликованы и без повторов.
3. Посчитать текущий mappingKey по DP-01; метрики разных SDK и общего monorepo не суммировать.
4. Ошибку одного продукта отделять от остальных; ошибка конфигурации target прекращает запуск до записей. Отчёт без токенов и полных payload.

**Артефакты:** `src/server/sanity/published-mapping.ts`, `src/server/sanity/queries.ts`.

**DoD:** читаются только опубликованные документы; некорректный mapping не попадает в сбор и в публичную read model; смена identity меняет mappingKey. Q08, Q11.

### DP-04 — Безопасный seed отсутствующих CMS-документов

**Входы:** DP-01, DP-03, FP-02, FP-04, схемы CW-02; 04 §§2, 6, 8–9; 06 §6.

1. Подготовить seed стартовой выборки: одна категория, 5–8 продуктов с однозначными package/repository (в прототипе 3–5). ID opaque и стабильны; основной пакет не выбирается по загрузкам.
2. Preflight: схема, ID, slug, URL, scoped npm-имена, дубли и коллизии в опубликованном и draft dataset; согласованность `--env` с парой CMS/DB.
3. `--dry-run` формирует локальный отчёт `create/skip/conflict` без записей и invalidation. `--apply` создаёт только отсутствующие документы как drafts; существующий ID пропускается без изменений.
4. Конфликт identity или уникальности помечается и не исправляется автоматически; `createOrReplace` и patch существующих записей не используются. Повторный запуск после частичного отказа досоздаёт недостающее.

**Артефакты:** `scripts/seed.ts`, `src/server/sanity/seed-writer.ts`, `src/domain/seed-records.ts`.

**DoD:** повторный dry-run/apply не создаёт дублей и не меняет отредактированные `summary` и `routeSlug`; scoped пакет и CMS без SDK обрабатываются по контракту; конфликт останавливает только свою запись. Q07.

### DP-05 — Metrics collector и один writer

**Входы:** DP-01–DP-03, FP-02–FP-04; 06 §§2–4, 6; 12 §§3–5.

1. Write runtime: session advisory lock окружения на direct connection; при занятом lock — выход с кодом 1 без записи. Upsert строк продукта одной транзакцией по правилу 06 §2: успех обновляет попытку и валидное значение, ошибка — только попытку, другая идентичность источника перезаписывает строку целиком.
2. `collect` с обязательными `--env` и `--dry-run|--apply`; production apply требует `--allow-production`. Dry-run строит тот же план без записи и invalidation.
3. npm: один запрос к range API за D−30…D−1 — сумма и ряд по дням; неполное окно → `unknown` с `incomplete_period`. GitHub: stars, open issues (с оговоркой про PR), license, идентичность репозитория. Только публичные HTTPS, проверка redirect, private адресов и размера ответа; пакеты не исполняются.
4. Timeout 10 s, до 3 попыток с backoff и jitter для временных ошибок, GitHub последовательно, общий concurrency не больше 2, учёт Retry-After. Постоянные ошибки не повторяются.
5. Перед записью перечитать mapping; при изменении пропустить продукт с отметкой в отчёте.
6. Очищенный JSON-отчёт по 06 §6, хранение 14 дней; exit codes 0 / 2 / 1.

**Артефакты:** `scripts/collect.ts`, `src/server/collector/metrics.ts`, `src/server/sources/npm.ts`, `src/server/sources/github.ts`, `src/server/db/metrics-writer.ts`, `src/server/db/collector-lock.ts`, `src/server/cache/import-revalidate-client.ts`.

**DoD:** dry-run без мутаций; занятый lock не пишет ни строки; ошибка источника не стирает валидное значение; crash между продуктами исправляется новым запуском; смена mapping не смешивает SDK; ряд по дням соответствует периоду суммы. Q08, Q09.

### DP-06 — Read model метрик, fallback и cache hooks

**Входы:** DP-01–DP-05, FP-02, CW-05 для интеграционного smoke; 05 §2, 06 §5.

1. SQL-запрос к `metrics_current`, сверенный с текущим опубликованным mapping по идентичности источника; несовпадающие строки отдаются как «метрики для нового источника ещё не собраны».
2. При ошибке показывать последнее валидное значение с исходными датами и периодом; свежесть 48 часов, устаревшее — с меткой. Ноль не подменяет ошибку.
3. Недоступность PostgreSQL не ломает редакционную страницу и не превращается в 404.
4. После успешной записи вызвать `/api/import-revalidate` (handler в CW-05) с environment и allowlist product IDs. Ошибка инвалидации остаётся в отчёте, данные не откатываются, TTL 3600 s ограничивает устаревание. Команда `cache:refresh` повторяет инвалидацию.

**Артефакты:** `src/server/db/queries/current-metrics.ts`, `src/server/catalog/read-model.ts`, `scripts/cache-refresh.ts`.

**DoD:** last-attempt и last-valid различаются; 0/null, текущий/прежний источник и fresh/stale различаются; публикация AI-review не влияет на показ метрик; ошибка инвалидации видна и не откатывает данные; отказ БД не ломает контент. Q06, Q08, Q09.

### DP-07 — Чтение опубликованного AI-review и расчёт балла

**Входы:** DP-01, DP-03; 04 §§2, 6; 07 §§1–4. Записи в БД нет.

1. В публичном read layer читать опубликованный `aiReview` продукта из Sanity и валидировать: `productId`, `methodologyVersion`, `mappingKey`, ровно три сигнала, enum state/kind, evidence для present/absent.
2. Если `mappingKey` совпадает с текущим — вычислить completeness и score по `cms-ai-support-v1` (25/20/20, знаменатель 65, half-up один раз) и `evidenceAsOf`. Если не совпадает — `unknown` с `mapping_changed`, `score = null`. Нет review — `unknown`.
3. Свежесть: старше 90 дней от `evidenceAsOf` — пометка stale. В Studio — подсветка review старше 75 дней (badge или сортировка списка).
4. Ошибка чтения Sanity обрабатывается как отказ CMS по 08: без валидного кеша — 503, не выдуманный балл.

**Артефакты:** `src/domain/ai-readiness.ts`, `src/server/catalog/ai-review.ts`, Studio badge устаревания.

**DoD:** расчёты 100/69/81/38/null по 07; official/community, absent/error и `mapping_changed` различаются; публикация нового review видна после webhook без отдельного запуска; граница 90 дней проверена на фиксированных часах. Q11.

### DP-08 — Ежедневный запуск collector и восстановление метрик

**Входы:** DP-05, CW-05 (общий подход к защищённым handlers), FP-04; 05 §2, 12 §§4–6. Lead maintenance в том же workflow поставляет LM-09.

1. Workflow `daily` в GitHub Actions только с `workflow_dispatch`, без `schedule`: job сбора метрик с collector credentials и место для job lead maintenance из LM-09. Concurrency `collector-<env>`, `cancel-in-progress = false`.
2. Handler `/api/cron/daily`: проверка `CRON_SECRET`, вызов GitHub API `workflow_dispatch` для своего окружения токеном `GITHUB_DISPATCH_TOKEN` (fine-grained, `actions:write`, один репозиторий). В FP-04 проверить, нужен ли перед dispatch вызов включения workflow.
3. Настроить Vercel Cron раз в день; ручной запуск — тот же `workflow_dispatch`.
4. Rehearsal восстановления метрик: пустая test DB из миграций, новый collector run, read smoke. SQL-бэкап метрик не делается.

**Артефакты:** `.github/workflows/daily.yml`, `src/app/api/cron/daily/route.ts`, `vercel.json` (crons), запись rehearsal.

**DoD:** Vercel Cron на development запускает workflow и обновляет метрики; неверный secret отклоняется; в workflows нет `schedule`; восстановление новым сбором проверено. Q09, Q10.

## Границы прототипа и complete v1

**Прототип** на development для 3–5 CMS: DP-01–DP-07 в минимальном объёме, миграции, seed dry-run/apply, collect dry-run/apply, ручная публикация `aiReview` в Studio и её появление на сайте после webhook. Включает lock contention, частичный отказ источника и fallback, смену mapping между чтением и записью, хук инвалидации. Очищенные API fixtures и реальные ограничения источников фиксируются; fake не выдаётся за live smoke.

**Complete v1** доводит задачи до DoD, включая production guards и grants, ежедневный запуск DP-08 и полный набор Q07–Q11 и Q17 (роли). Общие gates Q01–Q19 — по 11.

## Реализационные уточнения

1. **Версия SDK для AI в mappingKey:** берётся из опубликованного `types` evidence (`packageVersion`). Пока review нет, компонент сериализуется как JSON `null`; при появлении версии ключ меняется. Закрыть до DoD DP-01.
2. **Незавершённое npm-окно:** `status = unknown`, `reason = incomplete_period`; `ok` для неполного периода запрещён. Закрыть в fixtures DP-01 и проверить в DP-05.
