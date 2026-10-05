# PkgCompass: ограниченный pipeline v1

Дата: 5 октября 2026. Актуальный контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](decisions/0014-learning-project-simplifications.md). CLI ещё не реализован.

## 1. Ответственность

Sanity хранит продукты, редакционный контент, подтверждённый mapping и ручной AI-review. PostgreSQL хранит текущее состояние метрик. Посещение страницы не запускает сбор. Импорт не меняет displayName, slug, references, текст, SEO, reviewedAt и публикацию.

Seed создаёт только отсутствующие документы как drafts со стабильными ID, существующие пропускает. Изменения seed не перезаписывают правку редактора. Dry-run читает и проверяет, пишет только локальный отчёт; не пишет в CMS и БД и не запускает invalidation.

## 2. Модель данных

Таблица `metrics_current`: одна строка на `(product_id, source, metric)`.

| Поле | Значение |
| --- | --- |
| `product_id`, `source` (`npm` / `github`), `metric` | Ключ строки |
| `source_entity_id`, `source_identity`, `source_url` | ID и точное имя пакета или репозитория, из которого взято значение |
| `last_attempt_at`, `last_status`, `last_reason` | Последняя попытка: `ok` / `error` / `unknown` / `not_applicable` и причина |
| `valid_value`, `valid_observed_at`, `valid_fetched_at` | Последнее валидное значение; `null`, если его не было |
| `valid_period_start`, `valid_period_end` | Период для npm-загрузок |
| `valid_series` | JSONB: загрузки npm по дням за тот же период, только для метрики загрузок |
| `run_id`, `updated_at` | Запуск, который записал строку |

SQL tooling: Drizzle ORM + drizzle-kit, версионированные миграции в `migrations/`. Локальные domain IDs совпадают с Sanity IDs без префикса drafts. FK на Sanity нет, references проверяет read layer.

`mappingKey` — hash семантического mapping для AI-review: product ID, primary package/repository IDs и точные внешние имена, версия выбранного SDK. Правка summary ключ не меняет. Метрики с ним не сверяются: версия SDK из review не должна сбрасывать метрики. Канонизация: JSON с явно перечисленными отсортированными ключами, UTF-8, SHA-256. Один helper используют Studio, collector и read layer.

Правило записи: успешное наблюдение обновляет и последнюю попытку, и валидное значение. Ошибка обновляет только последнюю попытку, валидное значение остаётся с исходной датой. Если у строки другой `source_entity_id` или `source_identity`, новый запуск перезаписывает её целиком: данные прежнего пакета или репозитория не переносятся на новый. Строки продукта обновляются одной транзакцией; общей транзакции на весь каталог нет.

## 3. Один writer и сбой

Workflow сбора запускается только через `workflow_dispatch`, concurrency group `collector-<environment>`, `cancel-in-progress = false`. Каждый writer, включая локальный `--apply`, держит PostgreSQL session advisory lock на окружение на отдельном direct connection. Если lock занят, writer завершается без записи с понятным отчётом. Lock освобождается при закрытии соединения.

1. Получить lock, загрузить опубликованный mapping, проверить уникальность и источники.
2. Собрать по продуктам: HTTP timeout 10 s, до 3 попыток для временных ошибок, backoff с jitter. GitHub последовательно, общий concurrency не больше 2.
3. Провалидировать ответ. Перед записью перечитать semantic mapping: если он изменился, пропустить продукт и отметить это в отчёте.
4. Записать строки продукта одной транзакцией.
5. Сохранить очищенный JSON-отчёт, вызвать защищённую invalidation. Её отказ не откатывает данные, устаревание ограничивает TTL 3600 s.
6. После crash — новый запуск и новый сбор. Частично обновлённые продукты допустимы, resume не нужен.

HTTP-запросы только к отобранным публичным HTTPS URL. Проверяем redirects, private/loopback адреса и размер тела; не исполняем пакеты, MCP или сторонний код. 429 учитывает Retry-After/reset; постоянная ошибка авторизации или валидации не повторяется.

## 4. Метрики v1

npm: загрузки выбранного SDK за 30 завершённых UTC-дней D−30…D−1 одним запросом к range API (`/downloads/range/{start}:{end}/{package}`). Ответ даёт и сумму, и ряд по дням для спарклайна. Если источник ещё не опубликовал конец окна, наблюдение получает `status = unknown`, `reason = incomplete_period`, а прошлое валидное значение сохраняется. HTTP 200 не доказывает полноту. Scoped packages запрашиваются отдельно. Значения — неотрицательные целые; даты и пакет сверяются с запросом.

GitHub: stars, open issues (с подписью «включая PR», если используется `open_issues_count`), license и идентичность репозитория. Release/version берём из выбранного npm-пакета с отдельной подписью. Показатели SDK и monorepo не суммируем.

Источники: [npm download counts](https://github.com/npm/registry/blob/main/docs/download-counts.md), [GitHub REST](https://docs.github.com/en/rest/repos/repos).

## 5. Read model, свежесть и AI-review

Read model — SQL-запрос к `metrics_current`, сверенный с текущим опубликованным mapping: строка показывается, только если её `source_entity_id` и `source_identity` совпадают с выбранным пакетом или репозиторием. Иначе UI сообщает, что метрики для нового источника ещё не собраны.

0 — настоящий ноль, `null` — валидного значения нет. При новой ошибке UI показывает последнее валидное значение с исходной датой, периодом и предупреждением. Свежесть метрик — 48 часов. Даты в UTC; дата больше чем на 5 минут в будущем отвергается.

AI-review в PostgreSQL не копируется. Read layer читает опубликованный `aiReview` из Sanity, сверяет его `mappingKey` с текущим и считает балл по [07](07-ai-readiness.md). Публикация review инвалидирует карточку, каталог и сравнения через webhook, как любой контент.

## 6. Отчёт, CLI и хранение

Планируемый CLI: `npm run seed -- --env development --dry-run`, `npm run collect -- --env development --dry-run|--apply`. Production apply требует `--allow-production`. `--env` выбирает CMS и БД как единую пару targets.

Отчёт: `runId`, environment, startedAt/finishedAt, итог `succeeded` / `partial` / `failed`, статусы продуктов и источников, updated/skipped, причины, duration, статус кеша. Exit code 0 — без технических ошибок, 2 — частичный результат, 1 — failed или lock busy. `unknown` и `not_applicable` не считаются сбоем транспорта. Отчёты CI хранятся 14 дней, без payload, секретов и PII.

Истории метрик нет, поэтому нет retention и cleanup. SQL-бэкап метрик не нужен: при потере БД миграции создают схему, новый сбор восстанавливает текущее состояние. Утверждённые evidence хранятся в Sanity и восстанавливаются из CMS export.

## 7. Приёмка

Dry-run без mutations; seed без дублей и перезаписи; частичный отказ сохраняет last-valid с датой; один lock на все пути записи; crash между продуктами исправляется новым сбором; смена mapping не смешивает SDK; спарклайн соответствует периоду суммы; invalidation/TTL проверены; восстановление новым сбором работает. Полный набор — [11](11-quality-plan.md).
