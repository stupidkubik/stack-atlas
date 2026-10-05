# План ядра данных и collector PkgCompass

Дата: 5 октября 2026. Статус: план реализации по контрактам v1. Этот документ не описывает существующий код и не меняет продуктовые решения.

## Границы и источники правил

План охватывает SQL-схему снимков, чтение подтверждённого mapping из Sanity, seed, сбор метрик, перенос опубликованного ручного AI-review, read model/fallback, cache hooks и обслуживание истории снимков. Sanity остаётся владельцем редакционных документов, mapping и `aiReview`; в data-and-collector потоке PostgreSQL хранит `metrics_snapshots` и `ai_snapshots`. Private leads остаются отдельной областью БД по 09/12 и root plan. Seed не редактирует существующие документы. Collector не меняет editorial fields и не запускает сбор из запроса страницы.

Нормативные контракты: [04 — контентная модель](../04-content-model.md), [05 — архитектура](../05-architecture.md), [06 — pipeline](../06-data-pipeline.md), [07 — AI-readiness](../07-ai-readiness.md), [11 — приёмка](../11-quality-plan.md), [12 — эксплуатация](../12-operations.md), [ADR 0013](../decisions/0013-marketing-v1-and-simple-pipeline.md). При расхождении применять ADR 0013 и актуальные документы 04–12. Упоминания путей ниже — **предложенные пути реализации**; файлы и команды предстоит создать.

Основа задач — root foundation: **FP-01 bootstrap**, **FP-02 env/config adapters и fixtures**, **FP-03 migrations/roles baseline**. Этот план добавляет доменные контракты и подробные миграции snapshots поверх основы FP-03, не дублируя bootstrap и общие env-адаптеры.

Порядок зависимостей: `FP-01 → FP-02 → FP-03 first pass → DP-01 → DP-02 local/CI migrations → FP-04 dev targets → DP-02 dev migrations/role smoke → DP-03 → DP-04`; FP-03 second pass проверяет grants после появления snapshot и lead tables. DP-05 содержит общий write runtime и metrics flow, DP-07 зависит только от общего write runtime из DP-05, а DP-06 query/read model может завершаться после DP-05 и DP-07. CW-05 владеет общим revalidation route handler; этот план подключает к нему snapshot client и `cache:refresh`. DP-04 — единственный seed CLI; schema inputs принадлежат CW-02, а DP-04 предоставляет фактические seed records и их загрузку.

## Задачи

### DP-01 — Доменные контракты снимков и mappingKey

**Входы и зависимости:** FP-01, FP-02; определения полей и инвариантов из 04 §1–2, 06 §2–5, 07 §1–3.

**Шаги:**

1. Описать runtime-валидацию published mapping, `metricsSnapshot`, `observation`, `aiReview` и `aiReadinessSnapshot`. Валидация различает `0`, `null`, `unknown`, `error` и `not_applicable`; принимает только перечисленные статусы и enum-значения; требует UTC timestamps и не допускает будущее более чем на 5 минут.
2. Зафиксировать в чистом domain-коде правила mappingKey: канонический JSON с явно заданными полями и порядком ключей, UTF-8, SHA-256. В ключ входят стабильный `libraryId`, ID и точные внешние имена выбранных package/repository и, для AI-review, версия выбранного SDK согласно 06. Editorial text, slug и display name в ключ не входят.
3. Для сравнений использовать shared `pairKey` helper из CW routes domain; не создавать дублирующую реализацию в data/collector. Здесь фиксируются только stable library IDs и точные внешние package/repository identities, нужные seed/collector.
4. Подготовить синтетические fixtures: обычный и scoped npm package, monorepo с несколькими SDK одной CMS и одним repository, CMS без SDK, rename внешнего имени, mapping change, пустое/невалидное поле, snapshots с нулём и неизвестным значением; для AI — complete, incomplete, not applicable и несовпадающий mapping.
5. Зафиксировать сериализованные примеры и причины validation failure так, чтобы collector и Studio mapping action вычисляли один и тот же ключ на одних входах.

**Артефакты:** предложенные пути `src/domain/data-contracts.ts`, `src/domain/mapping-key.ts`, `tests/fixtures/data/` и `tests/domain/data-contracts.test.ts`.

**DoD:** одна и та же семантическая mapping даёт одинаковый mappingKey независимо от порядка полей входного объекта; изменение package/repository identity или подтверждённой версии SDK для AI меняет ключ; editorial-only правка его не меняет. Studio action, collector и read layer используют один hash contract. Fixtures проходят schema/domain checks; ни один сигнал не превращает `unknown` или `error` в отрицательное доказательство. Покрытие приёмки: Q08, Q11.

### DP-02 — Snapshot SQL migrations и права таблиц

**Входы и зависимости:** первый проход FP-03 (migration runner, connections, пустые роли); подтверждённые контракты DP-01; 05 §3, 06 §2–3 и 12 §2, 6. Snapshot GRANT входят во второй проход FP-03 после создания таблиц. Миграции проверяются локально/в CI до FP-04; проверка на live development target выполняется после создания target задачей FP-04.

**Шаги:**

1. Создать версионированную Drizzle/SQL migration для `metrics_snapshots` и `ai_snapshots`. В отдельных колонках хранить UUID `id`, UUID `run_id`, `library_id`, `mapping_key`, время сбора/переноса, `schema_version` или `methodology_version`, а структурированные observations/signals — в JSONB. Для AI добавить `evidence_as_of`, `review_revision`, `completeness`, nullable `score` по контракту 07.
2. Добавить `UNIQUE(run_id, library_id)` для каждой таблицы и индексы `(library_id, mapping_key, collected_at, id)` и `(library_id, mapping_key, checked_at, id)`. Внешний ключ на Sanity не добавлять: целостность references проверяется на read path.
3. Применить grants существующих ролей FP-03: public web reader — только SELECT snapshot tables и без доступа к lead tables; collector writer — snapshot read/insert и удаление для maintenance retention, без доступа к lead tables; migration owner получает необходимый DDL/backup доступ к обеим группам таблиц. Ни одна DB-роль не пишет в Sanity. Точные grants совпадают с FP-03/12; отдельный review-writer не создавать.
4. Проверить миграции на пустой локальной БД и временной CI БД; после FP-04 применить их к development target тем же migration command из 12. Зафиксировать фактический порядок и способ отката только для ещё пустой/тестовой схемы; для production применять совместимые вперёд миграции.
5. Проверить повторное применение миграционного runner по его версионному журналу, чтение web-role, запрещённый доступ web-role к leads и отдельность migration credentials. Не добавлять таблицы запусков, receipts, pointers, exclusions или reconciliation.

**Артефакты:** предложенные пути `migrations/`, `src/server/db/schema.ts`, `src/server/db/queries/snapshots.ts` и интеграционные проверки миграций/GRANT.

**DoD:** таблицы соответствуют 06/07, unique/indexes и роли проверены на реальном PostgreSQL; `library_id` не требует локальной копии редакционной сущности; web-role не может читать private lead state; миграция запускается штатным `db:migrate`. Покрытие: Q08, Q09, Q10, Q17.

### DP-03 — Чтение и проверка published mapping из Sanity

**Входы и зависимости:** DP-01, FP-02 и FP-04 для live Sanity target; CW-02 schema inputs; 04 §§2, 6–7; 05 §§1, 3; 06 §§1, 3; 07 §3. Локальные fixture adapter можно реализовать до FP-04.

**Шаги:**

1. Реализовать read-only Sanity adapter для опубликованных `library`, `package`, `repository` и `aiReview`. Collector использует published perspective; preview/draft token не используется, draft не считается текущим mapping или опубликованным review.
2. Свести `_id`/`_ref` к stable domain IDs и проверить, что primary package/repository входят в соответствующие ссылки, scope repository согласуется с package, npm-name и repository identity однозначны, ссылки опубликованы и не дублируются.
3. Проверить актуальный mappingKey по DP-01; составлять отдельный mapping на продукт, не суммировать метрики нескольких SDK или CMS по общему monorepo repository.
4. Перед записью collector повторно перечитывает semantic mapping. При изменении mapping пропускает продукт, указывает обе наблюдённые идентичности в очищенном диагностическом отчёте и предлагает новый сбор. Изменение не приводит к правке CMS.
5. Ошибку чтения/валидации одного продукта отделять от остальных; ошибка общего конфигурационного target прекращает run до записей. Отчёт не содержит токенов, полных API payload или private editorial notes.

**Артефакты:** предложенные пути `src/server/sanity/published-mapping.ts`, `src/server/sanity/queries.ts` и fixtures из DP-01.

**DoD:** читаются только опубликованные документы; malformed/ambiguous mapping не попадает в сбор или public read model; корректная смена package/repository identity меняет mappingKey; редакционные поля остаются вне mapping hash. Покрытие: Q08, Q09, Q11.

### DP-04 — Безопасный seed отсутствующих CMS-документов

**Входы и зависимости:** DP-01, DP-03, FP-02, FP-04, CW-02 schema inputs; seed-инварианты из 04 §§2, 6, 8–9; команда из 06 §6 и 12 §3. DP-04 владеет единственным seed CLI и записью draft-документов; CW-02 не зависит от выполнения DP-04.

**Шаги:**

1. Подготовить проверенный исходный seed для выбранной стартовой выборки: одна CMS category, 5–8 library identities и их однозначные package/repository связи; в прототипе достаточно 3–5 CMS. Идентификаторы opaque и стабильны, не генерируются заново при каждом запуске. Seed содержит только подтверждённые источники и редакционный материал, подготовленный для черновика; не выводит primary package из downloads.
2. Добавить preflight: проверка схемы, ID, slug, URL, scoped npm names, duplicate identity/reference и коллизий в опубликованном и draft dataset. Проверить полномочия и согласованность `--env` с парой CMS/DB из FP-02.
3. `--dry-run` читает CMS и формирует локальный очищенный отчёт `create/skip/conflict`; не пишет Sanity/PostgreSQL и не вызывает cache invalidation. `--apply` создаёт только отсутствующие документы как drafts. Если стабильный `_id` уже существует как draft или published, пропускает его и не меняет ни одно его поле.
4. Если под ожидаемым ID найдена сущность с другой immutable identity или обнаружена коллизия уникального package/repository/slug, помечает конфликт и не исправляет запись автоматически. Редактор устраняет его в Studio. Не использовать `createOrReplace`/patch существующей editorial-записи.
5. Создавать отсутствующие документы последовательно с отчётом по каждой записи. При частичном отказе повторный запуск безопасно пропускает уже созданные записи и продолжает отсутствующие; seed не переписывает `summary`, `routeSlug`, `reviewedAt`, references или публикационный статус.

**Артефакты:** предложенные пути `scripts/seed.ts`, `src/server/sanity/seed-writer.ts`, `src/domain/seed-records.ts` и команда `npm run seed -- --env <development|production> --dry-run|--apply`.

**DoD:** повторный dry-run/apply не создаёт дубликаты и не меняет существующие документы; в тесте уже отредактированные `summary` и `routeSlug` остаются неизменны; scoped package и CMS без SDK обрабатываются по контракту; conflict останавливает только затронутую запись и явно отражён в отчёте. Dry-run не вызывает записи и invalidation. Покрытие: Q07.

### DP-05 — Metrics collector и один writer

**Входы и зависимости:** DP-01…03, DP-02, FP-02, FP-03, FP-04; 05 §§1–3, 06 §§2–4, 6 и 12 §§3–5.

**Шаги:**

1. Сначала реализовать общий write runtime, который не зависит от npm/GitHub: session-level advisory lock для окружения на direct PostgreSQL connection; атомарный per-product snapshot insert с `ON CONFLICT DO NOTHING`; единый формат report/error; shared cache invalidation client interface с fake/mock transport для offline/CI. На этом шаге не требуется готовность CW-05 handler. Для apply при занятом lock завершить до записи с exit code `1` и причиной `lock busy`. GitHub Actions использует `collector-<environment>`, `cancel-in-progress=false`; DB lock обязателен для локального и CI apply.
2. На этом runtime реализовать `collect --mode metrics` с обязательными `--env` и `--dry-run|--apply`; production apply требует `--allow-production`. Сначала валидировать окружение и config, затем загрузить published mapping. Dry-run формирует тот же план источников/ошибок, но не делает snapshot insert и cache invalidation.
3. Запрашивать только выбранный npm package (включая scoped name) и выбранный repository по публичным HTTPS endpoints. Проверять redirect target, запрет private/loopback адресов и максимальный размер ответа; не устанавливать и не исполнять пакеты/репозитории. npm окно — 30 доступных завершённых UTC-дней `D−30…D−1`; GitHub поля — stars, open issues (с оговоркой, если поле включает PR), license и точная repository identity; release/version — от выбранного npm package.
4. Ограничить HTTP timeout 10 секундами и временные retries тремя попытками с backoff+jitter. GitHub выполнять последовательно, общий concurrency не выше двух. Учитывать Retry-After/reset для 429. Постоянные auth, schema и validation ошибки не ретраить.
5. Сохранять результат по каждому продукту, включая source-level `error`/`unknown`/`not_applicable` рядом с успешными observations. Ошибка одного источника не стирает другой источник. Значение 0 — валидный результат; отсутствующее/недоказанное значение — null с причиной. Незавершённое npm-окно не маркировать `ok`; оставить причину `incomplete_period`, чтобы read model показал предыдущее успешное значение с исходным периодом.
6. Перед вставкой повторно проверить semantic mapping (DP-03). Создавать новый `runId`; для каждого продукта сделать атомарную вставку одного полного snapshot row через общий write runtime. Не открывать транзакцию на весь каталог: уже записанные продукты могут сохраниться при crash/ошибке следующих продуктов. Если процесс аварийно завершился, следующий запуск использует новый `runId` и собирает заново.
7. Сформировать очищенный JSON report с `runId`, environment, mode, временем старта/окончания, итогом, product/source statuses, inserted/skipped, причинами, duration и cache status; сохранить как локальный/CI artifact на 14 дней согласно 06/11. Exit codes: `0` — без технических ошибок, `2` — частичный результат, `1` — failed или lock busy.

**Артефакты:** предложенные пути `scripts/collect.ts`, `src/server/collector/metrics.ts`, `src/server/sources/npm.ts`, `src/server/sources/github.ts`, `src/server/db/snapshot-writer.ts`, `src/server/db/collector-lock.ts`, `src/server/cache/import-revalidate-client.ts`. Cache route handler принадлежит CW-05.

**DoD:** dry-run без мутаций; занятый lock не пишет ни одной строки; успешные observations и ошибки источников хранятся в одном snapshot продукта; частично завершённый run читаем и не требует resume; повторная доставка с тем же `runId/libraryId` не обновляет payload; crash между продуктами исправляется новым run; смена package/repository mapping не смешивает старые метрики с текущими. Покрытие: Q08, Q09.

### DP-06 — Snapshot read model, fallback и cache hooks

**Входы и зависимости:** DP-01…05, FP-02, CW-05 revalidation handler для интеграционного smoke; 05 §2, 06 §3, 5–6, 12 §§3–5. Read query/read model может разрабатываться параллельно с DP-07 и считается завершённым после подключения обоих snapshot write paths.

**Шаги:**

1. Реализовать SQL read queries без materialized read model/pointers: фильтровать строго по текущему `libraryId + mappingKey`; среди записей сортировать по времени, затем UUID. Возвращать последнюю попытку отдельно от последних `status=ok` значений по каждому source/metric.
2. При новой ошибке показывать last-valid с первоначальными `observedAt`, `fetchedAt`, периодом и пояснением. Не подменять ошибку нулём, не брать snapshot с прежним mappingKey. Metrics freshness — 48 часов; stale значение остаётся с датой и меткой устаревания.
3. При недоступности PostgreSQL сохранять редакционную страницу, явно показывая недоступность метрик. Не превращать отказ DB в ложный 404 и не запускать сбор из web request.
4. После успешных snapshot inserts вызвать shared client из DP-05 к защищённому `/api/import-revalidate`, handler которого реализуется в CW-05: передавать только environment и allowlisted product IDs; handler проверяет secret/target и вычисляет tags для snapshots/catalog/comparisons. До готовности handler client проверяется через fake transport, реальная интеграция выполняется после CW-05. Ошибка invalidation остаётся в отчёте и не откатывает уже записанные данные; TTL cache 3600 секунд ограничивает устаревание. Поддержать предусмотренную операционную команду `cache:refresh` для повторной invalidation.
5. Не считать dry-run успешным cache refresh и не invalidировать по неуспешной вставке. Проверить, что успешная публикация/снятие/rename через CMS webhook и импортные invalidations достигают нужных карточек/сравнений/каталожных страниц в пределах контрактов 05/Q06.

**Артефакты:** предложенные пути `src/server/db/queries/current-snapshots.ts`, `src/server/catalog/read-model.ts`, `src/server/cache/import-revalidate-client.ts` из DP-05 и `scripts/cache-refresh.ts`. Route handler — CW-05; DP-06 его не создаёт.

**DoD:** last-attempt и last-valid вычисляются раздельно; 0/null, текущий/старый mapping и fresh/stale различаются; ошибки cache invalidation видны в отчёте и не приводят к ложному rollback; повтор invalidation идемпотентно обновляет теги; DB failure не ломает редакционный контент. Покрытие: Q06, Q08, Q09.

### DP-07 — Перенос опубликованного ручного AI-review

**Входы и зависимости:** DP-01…03, DP-02, FP-02, FP-03, FP-04 и общий write runtime/cache client из DP-05 step 1; 04 §§2, 6, 7; 06 §5; 07 §§1–4; 12 §§3–5. Полная metrics реализация DP-05 step 2 и read model DP-06 не являются блокирующими зависимостями для AI ingest.

**Шаги:**

1. Добавить `collect --mode ai` с теми же `--env`, dry-run/apply, session advisory lock, новым `runId`, отчётом и ограничением production apply. Он читает published `aiReview` из Sanity; Studio/editor остаётся единственным writer. Не добавлять отдельный review handler, Sanity review-write token или DB review-writer.
2. Валидировать `libraryId`, published `_rev`, `methodologyVersion`, mappingKey и ровно три сигнала `types`, `llmsTxt`, `mcp`; проверять enum state/kind, evidence shape и обязательные доказательства для `present`/`absent`. Положительное или отрицательное редакционное заключение без требуемого evidence не переносить как complete.
3. Если review mappingKey совпадает с текущим mapping, вычислить completeness и score по версии `cms-ai-support-v1`: веса 25/20/20, фиксированный знаменатель 65, округление один раз half-up. `checkedAt` — время переноса, `evidenceAsOf` — самая ранняя дата обязательных сигналов полного review; перенос не освежает evidence.
4. Если опубликованного review нет, создать incomplete/unknown snapshot без score. Если его mappingKey не совпадает, сохранить `unknown` с причиной `mapping_changed`, score=null; старые сигналы не перепривязывать. Неполный review целиком замещает предыдущую текущую оценку, не объединяется с ней. Последний полный snapshot остаётся отдельным fallback с исходной датой.
5. При ошибке чтения Sanity не создавать фиктивную новую проверку: записать техническую ошибку в run report и оставить прежнюю оценку со своей датой. При чтении нового published review создать новый snapshot с `reviewRevision = _rev`; до следующего синхронного read/invalidation UI показывает `Review update pending`, прежний complete snapshot — как предыдущий.
6. После записи invalidировать карточку/каталог/сравнения тем же shared cache client из DP-05 и handler CW-05. Соблюдать AI freshness 14 дней по `evidenceAsOf`; stale assessment не маркировать свежим после повторного переноса.

**Артефакты:** предложенные пути `src/server/collector/ai-review.ts`, `src/domain/ai-readiness.ts`, `src/server/db/ai-snapshot-writer.ts` и Studio-side mappingKey calculation в рамках существующей схемы/действия публикации.

**DoD:** переносится только published revision; валидные расчёты дают 100/69/81/38/null согласно 07; official/community, absent/error и pending различаются; review с новым mapping не наследует старые результаты; изменение revision создаёт pending до новой AI snapshot; evidenceAsOf не меняется от повторного переноса. Покрытие: Q11.

### DP-08 — Retention, snapshot maintenance и restore rehearsal

**Входы и зависимости:** DP-02, DP-05…07, FP-03; 06 §6–7, 11 Q10, 12 §§3, 5–7.

**Шаги:**

1. Реализовать `maintenance --env … --dry-run|--apply` только для snapshot tables. Срок обычной истории — 30 дней. Dry-run вычисляет и показывает число/ID кандидатов и строки, сохраняемые как fallback; не удаляет данные и не запускает cache invalidation. Реальная область maintenance не включает lead state/rate limits: у них отдельный приватный контракт 09/12.
2. Сохранять последнюю попытку, rows, нужные как last-valid по источникам/метрикам, и последний complete AI snapshot даже за пределами 30 дней; применять тот же mappingKey/read ordering, что DP-06/07. Перед apply сверить backup snapshots, как требует 12.
3. На apply получить тот же session advisory lock окружения, что collector. При занятом lock завершиться без удаления. Под lock повторно вычислить cutoff и protected IDs; удалить только неподлежащие сохранению записи старше срока. Удаление выполнять транзакцией БД, чтобы ошибка операции откатила только cleanup batch, а не оставила его в неопределённом промежуточном состоянии.
4. Подготовить backup/restore rehearsal на изолированной БД: снять предусмотренную операционную копию snapshot tables, восстановить её в test target, сверить stable IDs/mappingKey и выбранные last-valid/latest/complete AI строки, выполнить read smoke; отдельно подтвердить, что потерянная snapshot history восстанавливается новым сбором, если backup недоступен.
5. Сохранить очищенный maintenance report: environment, cutoff, сохранённые/удалённые counts и причины, backup/restore smoke reference и итог. Команды должны требовать явный env; production apply — `--allow-production`.

**Артефакты:** предложенные пути `scripts/maintenance.ts`, `scripts/backup-snapshots.ts` или существующий backup command, `scripts/restore-snapshots.ts` или существующий restore command; SQL queries для retention в `src/server/db/maintenance.ts`.

**DoD:** dry-run не меняет данные; apply без lock не удаляет строки; 30-дневная очистка сохраняет все выбранные fallback-строки и последний complete AI snapshot; cleanup не читает и не удаляет leads; изолированный restore возвращает пригодный read model либо подтверждается план повторного сбора при утрате истории. Покрытие: Q10, Q17.

## Границы прототипа и complete v1

**Прототип ядра** закрывает сквозную цепочку на реальном development окружении для 3–5 CMS: DP-01…07 в минимальном объёме, стабильные migrations, seed `dry-run` и apply, metrics `dry-run` и apply, ручная публикация `aiReview` в Studio и перенос следующей AI-командой. Он включает проверку lock contention, partial source failure и last-valid fallback, изменение mapping между чтениями/записью, invalidation hook и pending → новая published AI revision → snapshot. Фиксируются очищенные API fixtures, даты и реальные ограничения источников. Это соответствует real smoke из 11 §2; fixtures/fakes не выдаются за live smoke.

**Complete v1** доводит все задачи до DoD, включая production-safe env guards/grants, полный retention apply, snapshot backup/isolated restore, расписание/отчёты согласно 12, полный набор Q07–Q11 и роль-проверки Q17. Общие release gates Q01–Q19 остаются из 11. В этом плане нет сроков: готовность определяется DoD и evidence соответствующего Qxx.

## Реализационные уточнения, не блокирующие старт

1. **Версия SDK для AI:** владелец DP-01 совместно с CW-02/Studio action закрепляет версию из опубликованного `types` evidence (`packageVersion` по 07 §3) как компонент входа mappingKey. Если такого evidence/review пока нет, компонент сериализуется как явный JSON `null` (детерминированный no-version value), чтобы метрики можно было собирать и без review; при появлении подтверждённой версии ключ меняется. Один serializer/hash helper используется Studio, collector и read layer; автоматический выбор latest не выполняется. Закрыть перед DoD DP-01.
2. **Незавершённое npm-окно:** владелец DP-01 фиксирует `status=unknown` вместе с `reason=incomplete_period`; `status=ok` запрещён для неполного периода. DP-05 проверяет, что такой observation не вытесняет last-valid. Закрыть в domain contract/fixture до DoD DP-01/05.
3. **Нет published review:** владелец DP-02 делает `review_revision` nullable; DP-07 пишет `null` только когда published review отсутствует. Не подставлять искусственную revision. Закрыть в migration/schema DoD DP-02 и fixture DP-07.
4. **Retention pin scope:** владелец DP-08 сохраняет fallback и последний complete AI snapshot для текущего опубликованного mapping; старые mappingKey не закрепляются и не попадают в current read model, поэтому истекают по обычному 30-дневному сроку. Отразить это predicate в dry-run и retention query.
