# Foundation: итоговая приёмка FP-03 и закрытие блока

Дата: 8 октября 2026. Финальный run `20261008T213903Z-FP-03-06fd3593`, environment `fixture`. FP-01, FP-02, FP-04 и FP-05 уже verified; последний остаток из [аудита](2026-10-08-foundation-audit.md) — FP-03 — проверен на отдельном локальном PostgreSQL 17. Нового runtime-кода не потребовалось.

## Приёмка FP-03

| Критерий | Подтверждение |
| --- | --- |
| Единая последовательность с нуля | Создан отдельный временный cluster и свежая БД. Bootstrap четырёх ролей; dry-run показывает четыре pending без создания migration schema; apply под `pkgcompass_migration_owner` записывает четыре migrations |
| Повтор безопасен | Bootstrap повторён; повтор apply оставляет четыре total recorded и ноль pending. Полные строки migration history и synthetic metric до/после равны; synthetic row удалена |
| Реальные права | Независимый существующий набор `fp04-sql-roles-independent` подключается каждой прикладной ролью, проверяет read/write/DDL и запрет public/collector чтения leads/rate limits. Три application tables принадлежат migration owner |
| History и atomicity | `foundation-db-independent` проверяет повреждение истории, неизменность dry-run, rollback проваленной миграции, атрибуты/эскалацию ролей и положительные/запрещённые запросы |
| Connections и CLI | В том же наборе при подключённой БД выполнена проверка `pg.Pool` для web и `pg.Client` для collector/migrations; explicit environment, mode, production guard и безопасные URL/errors проверены |
| Совместимые migrations | Правило schema-before-code, отдельная задача для удаления данных и отсутствие обещания rollback CMS/CRM/SQL описаны в README |

Финальный запуск: `foundation-db-independent`, `fp04-sql-roles-independent`, `lm-lead-postgres`, последовательно по файлам — **3 files / 15 tests passed / 0 skipped**. Последний набор дополнительно подтверждает concurrent rate limit и accepted terminal при позднем отказе. Использованы ранее написанные независимые suites и отдельный baseline observer; новые субагенты не запускались. Live Neon role evidence из прежнего прохода сохранено; повторный live доступ не потребовался.

Очищенное baseline evidence: [fresh-baseline.json](../../../artifacts/runs/20261008T213903Z-FP-03-06fd3593/evidence/fresh-baseline.json). SQL suites, cleanup и сверка DoD записаны отдельными checks в run. Временный PostgreSQL остановлен; созданный cluster удалён. Credentials и private rows из development/production не использовались.

## История попыток

Sandbox запретил shared memory при первом `initdb`; локальный запуск затем разрешён automatic approval review. В предварительном run `20261008T213718Z-FP-03-bb20ea4f` observer ошибочно ожидал `applied=0` при повторе, хотя API возвращает общее число записанных migrations. Ошибка assertion сохранена как fail; после исправления observer repeat/history/data проверки прошли. Предварительный run закрыт review. Финальный run заново создал БД и повторил весь baseline и все 15 tests без ошибок. Исторический GRANT fail из 6 октября также не удалён и не переименован в pass.

## Итог и следующий этап

FP-03 принят по собственному DoD; весь блок FP-01–FP-05 verified. Это основание и development прототип. CI integration matrix, restore/deletion, полные CW/DP/LM критерии и production gates остаются в своих задачах.

CW-16 пока planned: направление уже принято в ADR 0011, но нужны точные tokens, desktop/mobile макеты главной/продукта/сравнения/каталога/формы/consent, состояния loading/empty/error/stale и спецификация компонентов. Артефакты — tokens в Tailwind, макеты и `docs/design/README.md`; проверки — контраст AA и touch targets. CW-16 выполняется до CW-08, оценка плана 8–12 часов. Этот приёмочный проход не начинает дизайн автоматически.
