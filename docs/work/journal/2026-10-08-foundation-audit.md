# Foundation: проверка остатка

Дата: 8 октября 2026. Run `20261008T213453Z-FP-03-72f6c2cd`, environment `fixture`. Проверка плана, реестра, журналов, migration/connection кода и существующих тестов; новые live-запросы и изменения интеграций не выполнялись.

Последующее обновление: оставшаяся приёмка FP-03 выполнена в отдельном run; [итоговый отчёт](2026-10-08-foundation-final.md). Ниже сохранён исходный срез аудита до этой проверки.

## Результат по блоку 01

| Задача | Текущий статус | Остаток |
| --- | --- | --- |
| FP-01 | verified | Отдельного незакрытого пункта foundation не найдено; clean install/build evidence сохранено в предыдущих runs |
| FP-02 | verified | Отдельного незакрытого пункта foundation не найдено; конфигурация и fixture path реализованы |
| FP-03 | review | Новый полный приёмочный run для migration/role DoD после исторического сбоя GRANT |
| FP-04 | verified | Development targets и live adapters приняты; production относится к QA-05 |
| FP-05 | verified | Вертикальный прототип и пересчёт приняты; полный каталог и release gates относятся к следующим блокам |

Это сверка существующего evidence, а не новое воспроизведение всех verified задач.

## Что конкретно осталось в FP-03

Runner, bootstrap четырёх ролей, четыре domain migrations, проверки migration history, direct/pooled connection factories, CLI guards и правило совместимых migrations присутствуют. README содержит команды. Миграция `0004_app_role_grants.sql` проверяет фактические ACL и grant option; прежний дефект отсутствующих schema USAGE grants учтён.

Предыдущий [локальный отчёт FP-03](../../../artifacts/runs/20261006T065406Z-FP-03-4c8ce817/report.md) сохраняет первоначальный fail и последующие pass: fresh PostgreSQL apply/repeat, 15 независимых SQL tests, отдельные live Neon role probes. Он прямо требует нового полного acceptance run перед verified. [Журнал 6 октября](2026-10-06.md) подтверждает эти результаты; повышение других задач не заменяет приёмку FP-03.

Для закрытия:

1. На отдельном свежем локальном PostgreSQL выполнить bootstrap → все четыре migrations под migration owner; повтор должен дать ноль pending без изменения данных.
2. Выполнить migration/history/dry-run/rollback checks и реальные положительные/запрещённые запросы четырёх ролей к application tables. Проверить запрет public/collector доступа к leads и разделение direct/pooled consumers.
3. Сопоставить результаты с каждым пунктом DoD и прежним независимым evidence критических границ; сохранить очищенную сводку. Только при полном pass закрыть новый run как verified с `--dod-confirmed`.

Нового подтверждённого runtime-дефекта этот аудит не выявил. Необходимость нового кода определяется результатом приёмки; разработка SQL baseline с нуля не требуется. Полная restore rehearsal и CI integration matrix принадлежат QA-04/QA-01 и не добавляются в DoD FP-03.

Текущий запуск `npm run test:foundation-db`: 5 passed, 4 skipped. SQL target не был подключён; connection factory test при отсутствии target возвращается без проверки factories. Эти результаты не подтверждают реальную SQL-матрицу или новый clean database replay.

## Уже закрытые follow-ups FP-05

[Итоговый FP-05 отчёт](2026-10-08-fp05-final.md) явно сохраняет исходный срез до последующей настройки. Указанные там remote fixture CI и постоянная dev webhook delivery затем выполнены: remote run success на `182d87b`, automatic webhook 200 до и после redeploy — [отчёт настройки](2026-10-08-dev-delivery-ci.md). Повторно включать эти работы в остаток foundation не нужно.

LM-08 остаётся review до отдельной итоговой фиксации собственного DoD; QA-01 требует полного CI/build/SQL/HTTP/axe объёма. Это соседние задачи, а не новые незакрытые FP. Следующий содержательный этап после приёмки FP-03 — CW-16 и доведение CMS/public web по блоку 02.
