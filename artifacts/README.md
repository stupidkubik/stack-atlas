# Хранилище evidence разработки

`runs/` — локальное хранилище результатов отдельных работ. Оно создаётся скриптом `python3 scripts/worklog.py start` и целиком исключено из Git. Директории runs намеренно не включены в исходный checkout: первый run создаст их автоматически.

```text
artifacts/
  README.md              # tracked
  templates/             # tracked
  runs/<run-id>/         # ignored
    manifest.json        # task, env, UTC timestamps, base commit, checks/status
    report.md            # очищенная содержательная сводка
    evidence/            # очищенные screenshots, traces, HTML/test reports
```

Каждая проверка фиксирует command, outcome (`pass|fail|not_run`), optional Q01–Q19 и относительный путь к evidence. Скрипт не запускает command и не редактирует секреты автоматически; он записывает проверенный оператором результат. Run manifest использует собственную schemaVersion=1, которая не связана с runtime snapshots/events.

В local evidence допустимы только очищенные результаты. Email, IP, request credential, draft text, secrets, auth headers и raw provider payload здесь не хранятся. Private lead backups не относятся к evidence и требуют отдельного encrypted operator storage по [12](../docs/12-operations.md).

Evidence reports хранить 14 дней согласно [11](../docs/11-quality-plan.md). Сейчас автоматического cleanup/remote storage нет: после сохранения нужной безопасной сводки в `docs/work/journal/` вручную удалять только проверенные expired runs. Будущий CI в QA-01 настроит artifact retention14d отдельно; ignored файлы не попадают в remote вместе с Git push.

Долгоживущий текстовый журнал хранится в Git, содержит только очищенные результаты и ограничения. Локальный диск не обеспечивает backup/доступ с другого компьютера; внешний storage и production backup будут подключены в QA-04/QA-05 с проверкой restore.
