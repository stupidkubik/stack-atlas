# Рабочий процесс и журнал

Дата подготовки: 5 октября 2026. Это локальный рабочий контур разработки, доступный до появления npm-приложения. [План](../14-core-development-plan.md) задаёт работу; [tasks.md](tasks.md) — текущие статусы; [journal](journal/README.md) — история действий и результатов. Детальные требования/DoD не копируются в tracker.

## Работа с задачей

```sh
python3 scripts/worklog.py start FP-01 --summary "Создание каркаса" --env fixture
# Использовать RUN-ID из вывода предыдущей команды.
python3 scripts/worklog.py note RUN-ID --summary "Зафиксированы совместимые версии"
python3 scripts/worklog.py check RUN-ID --name "Production build" --command "npm run build" --outcome pass --summary "Build завершён"
python3 scripts/worklog.py finish RUN-ID --status review --summary "Готово к проверке DoD"
python3 scripts/worklog.py status
```

`check` записывает результат уже выполненной проверки, а не исполняет команду. `--gate Q01` необязателен; `--evidence evidence/build-report.txt` — существующий файл относительно своего run directory, без выхода из него. Не передавать секреты в текст аргументов. Для manual проверки `--command` может содержать безопасное описание метода.

`start` принимает только существующий ID из плана и environment `fixture|development|production`; environment здесь только метка evidence, не подключение к аккаунту. Он создаёт уникальный run с UTC временем и base Git commit, отмечает задачу in_progress и добавляет журнал. Локальная блокировка защищает одновременные изменения рабочей доски/журнала; один незакрытый run на задачу. Разные задачи можно вести параллельно, commits и merge выполняются отдельно через Git.

Статусы: `planned → in_progress → review → verified`; `blocked` фиксирует препятствие, возврат `planned` — прерывание работы без закрытого результата. Для продолжения закрытого run создать новый `start` той же задачи. Закрытые records не переписываются, новая проверка/review создаёт новый run. Для verified требуется хотя бы один pass, отсутствие fail/not_run среди записанных проверок и явный `--dod-confirmed`:

Если после checkout на другом компьютере board содержит `in_progress`, а ignored run отсутствует, восстановить evidence из собственного local storage либо вручную перевести строку в `planned`, записав в дневной журнал потерю/отсутствие локальных artifacts. Затем создать новый run; прежняя проверка не считается воспроизведённой.

```sh
python3 scripts/worklog.py finish RUN-ID --status verified --dod-confirmed --summary "DoD и evidence проверены"
```

Этот флаг — заявление исполнителя о выполненном DoD, а не автоматический сертификат. Одна успешная команда не заменяет все критерии задачи. Критические инварианты проверять независимо по QA/профильным планам. Если обязательная проверка fail/not_run, использовать blocked/review и фиксировать следующую проверку в новом run после исправления.

## Хранение и история

- `docs/work/tasks.md` отслеживается в Git. Статусы изменяет CLI; если требуется правка вручную, сохранить ID, title и пять колонок таблицы.
- `docs/work/journal/YYYY-MM-DD.md` — очищенный дневной журнал; день вычисляется в Europe/Belgrade, timestamps внутри — UTC. Подготовительная запись не закрывает реализационные задачи.
- `artifacts/runs/<RUN-ID>/` — manifest/report/evidence вне Git, retention14d и ограничения из [artifacts](../../artifacts/README.md).
- Запись содержит base commit; commit с завершёнными изменениями указывать в report/journal после commit при необходимости. Git commit не выполняется скриптом автоматически.

Проверка подготовки: `python3 scripts/worklog.py status`, `python3 -m unittest discover -s tests/tooling -v`, `git status --short`. Приложение, CI, real provider targets и private backups остаются задачами разработки.
