# PkgCompass: ограниченный pipeline v1

Дата: 5 октября 2026. Актуальный контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). CLI ещё не реализован.

## 1. Ответственность

Sanity хранит продукты, editorial content, подтверждённый mapping и ручной AI-review. PostgreSQL хранит снимки метрик/AI. Посещение страницы не запускает сбор. Импорт не меняет displayName, slug, references, текст, SEO, reviewedAt и публикацию.

Seed создаёт только отсутствующие документы как drafts со стабильными ID, существующие пропускает. Изменения seed не перезаписывают правку редактора. Dry-run читает/проверяет и пишет только локальный отчёт; не пишет CMS/БД и не запускает invalidation.

## 2. Минимальный контракт и SQL

| Запись | Поля и правило |
| --- | --- |
| Metrics snapshot | id UUID, runId UUID, libraryId, mappingKey, collectedAt, schemaVersion=metrics-v1, observations[] |
| Observation | source=npm/github, sourceEntityId, sourceIdentity, metric, status=ok/error/unknown/not_applicable, value/null, observedAt/null, fetchedAt, periodStart/periodEnd при npm, sourceUrl, reason? |
| AI snapshot | id UUID, runId, libraryId, mappingKey, checkedAt, evidenceAsOf/null, methodologyVersion, reviewRevision, completeness, score/null, signals; по 07 |

SQL tooling: Drizzle ORM + drizzle-kit, версионированные миграции в migrations/. Таблицы metrics_snapshots и ai_snapshots: поля идентичности/времени отдельными колонками, payload JSONB; unique(run_id, library_id) в каждой таблице. Индекс (library_id, mapping_key, collected_at/checked_at, id). Локальные domain IDs совпадают с Sanity IDs без drafts. PostgreSQL FK на Sanity не существует: references проверяет read layer.

mappingKey — hash только семантического mapping: product ID, primary package/repository IDs и точные внешние имена, версии выбранного SDK для AI. Редакционная правка summary не меняет ключ. Канонизация: JSON с явно перечисленными отсортированными ключами, UTF-8, SHA-256. Это идентичность источника, не протокол attempt/hash-доставки.

Снимки append-only; повтор сохранённого payload того же run/product — INSERT ON CONFLICT DO NOTHING. Новые внешние запросы всегда получают новый runId; доставки с другим payload под старым runId CLI не поддерживает. Нет отдельных run/receipt/pointer/exclusion таблиц. Если обнаружен неверный снимок, оператор удаляет конкретную запись по ID после backup и пересобирает источник; причина остаётся в операторском отчёте. История не объявляется аудитом неизменяемого юридического журнала.

## 3. Один writer и сбой

GitHub Actions concurrency group = collector-<environment>, cancel-in-progress=false. Все snapshot writers (включая локальный apply и snapshot cleanup) дополнительно держат одну PostgreSQL session advisory lock на окружение, на отдельном direct connection; при занятом lock завершаются без записи и с понятным отчётом. Lock освобождается при закрытии соединения; нет ledger/heartbeat. Seed меняет только CMS и запускается отдельно редактором.

1. Получить lock, загрузить published mapping и проверить уникальность/источники.
2. Собрать по продуктам с HTTP timeout 10s, до 3 попыток для временных ошибок, backoff с jitter; GitHub последовательно, общий concurrency максимум 2.
3. Провалидировать ответ; перед INSERT перечитать semantic mapping. При изменении пропустить продукт и предложить новый запуск. Старый mappingKey всё равно исключается из текущего чтения.
4. Записать один снимок на продукт, допускающий отдельные source errors, одним INSERT. Нет общей транзакции каталога.
5. Сохранить очищенный JSON-отчёт, вызвать защищённую invalidation; её отказ не откатывает данные. Резервный TTL 3600s ограничивает устаревание кеша.
6. После crash — новый запуск и новый сбор. Частично записанные продукты допустимы; отдельное resume не нужно. Два cron не могут писать одновременно.

HTTP fetch только по отобранным публичным HTTPS URLs. Проверяем redirects, private/loopback адреса, размер тела; не исполняем packages, MCP или сторонний код. 429 учитывает Retry-After/reset; постоянный auth/validation error не повторяется бесконечно.

## 4. Метрики v1

npm: загрузки выбранного SDK за 30 доступных завершённых UTC-дней. Сначала запрашиваем D−30…D−1; если источник ещё не опубликовал конец окна, сохраняем прошлый успех и reason=incomplete_period, не притворяемся, что HTTP 200 доказывает полноту. Реальный ответ/поведение окна проверяются прототипом. scoped packages запрашиваются отдельно. Значения — неотрицательные целые, даты/пакет сверяются.

GitHub: stars, open issues (подпись «включая PR», если используется поле open_issues_count), license и repository identity. Release/version берём из выбранного npm-пакета с отдельной подписью. Не суммируем SDK и monorepo-показатели. Тренды и 90-дневные графики не входят в обязательный v1.

Источник: [npm API](https://github.com/npm/registry/blob/main/docs/download-counts.md), [GitHub REST](https://docs.github.com/en/rest/repos/repos).

## 5. Read model, свежесть и AI-review

Read model вычисляется SQL-запросами, не сохраняется отдельными pointers. Для текущего mappingKey выбираем последнюю попытку; последние status=ok по каждому источнику/метрике — отдельно, порядок timestamp затем UUID. На объёме 5–8 продуктов этого достаточно; оптимизация только по измерению.

0 — настоящий ноль, null — нет валидного значения. При новом error показываем last-valid с исходной датой/периодом и предупреждением. Freshness metrics ≤48h, AI ≤14d от evidenceAsOf; даты UTC, будущее более 5 минут отвергается. Значения другого mapping не показываем как текущие.

AI-run раз в неделю и вручную переносит целостную опубликованную aiReview из Sanity только при совпадении review.mappingKey с текущим semantic mapping. Несовпадение — unknown(reason=mapping_changed), score=null; нужен новый review, старые сигналы не переносятся под новым mapping. Ошибка чтения сохраняет старую оценку с её датой; отсутствие review даёт unknown. Новый review не получает новую дату доказательств автоматически. До переноса UI отмечает «Review update pending», старый полный снимок показывает как предыдущий. Результаты двух review не смешиваем; актуальный score скрываем при несовпадении reviewRevision. Распределённая транзакция не нужна.

## 6. Отчёт, CLI и хранение

Планируемый CLI: npm run seed -- --env development --dry-run; npm run collect -- --env development --mode metrics|ai --dry-run|--apply. Production apply требует --allow-production. Эти команды предстоит создать; --env выбирает CMS и DB как единую пару targets.

Отчёт: runId, environment, mode, startedAt/finishedAt, succeeded/partial/failed, продукты/source statuses, inserted/skipped, причины, duration, cache status. Exit 0 — без технических ошибок, 2 — partial, 1 — failed или lock busy. Unknown/not_applicable не равны transport failure. Отчёты CI храним 14 дней, без payload/секретов/PII.

История 30 дней. Cleanup сохраняет последнюю попытку, last-valid по источникам и последний complete AI snapshot даже старше окна; работает под тем же lock, dry-run и после проверенного backup. Утверждённые evidence сохраняются в Sanity независимо от окна снимков. Обычный restore: восстановить контент и SQL backup; если метрики потеряны, выполнить полный новый сбор. История не восстанавливается из внешнего API гарантированно, это допустимое ограничение v1. Private lead state восстанавливается отдельно по 09/12.

## 7. Приёмка

Dry-run без mutations; seed без дублей/перезаписи; частичный отказ сохраняет last-valid; один lock на все writer paths; crash между продуктами исправляется новым сбором; смена mapping не смешивает SDK; review pending не выглядит новой проверкой; cleanup сохраняет fallback; invalidation/TTL и restore проверены. Полный набор — [11](11-quality-plan.md).
