# PkgCompass

Каталог headless CMS для JS/TS-сайтов. Текущий этап — подготовка разработки: спецификации и детальные планы готовы, локальный Git-репозиторий и рабочий журнал настроены. Приложение и внешние интеграции ещё не реализованы.

## Начало работы

1. Прочитать [реестр решений](docs/00-start-decisions.md), [продуктовую рамку](docs/02-product-and-scope.md) и [план ядра](docs/14-core-development-plan.md).
2. Выбрать задачу в [рабочем реестре](docs/work/tasks.md), проверить её зависимости и DoD в детальном плане.
3. Создать запись работы: `python3 scripts/worklog.py start FP-01 --summary "Начало каркаса приложения"`.
4. Добавлять результаты проверок и завершить запись по [рабочему процессу](docs/work/README.md).

Для рабочего журнала нужен Python 3.9+ (standard library, macOS/Linux). Node/npm, приложение, lockfile и CI появляются в FP-01/QA-01; `npm ci` пока не является доступной командой проекта.

## Документы и результаты

| Путь | Назначение |
| --- | --- |
| [docs/README.md](docs/README.md) | Контракты v1 и приоритет решений |
| [docs/14-core-development-plan.md](docs/14-core-development-plan.md) | Порядок исполнения и пять детальных планов |
| [docs/work/tasks.md](docs/work/tasks.md) | Текущие статусы 44 задач |
| [docs/work/journal/](docs/work/journal/README.md) | Очищенная история работы по дням |
| [artifacts/README.md](artifacts/README.md) | Локальные evidence runs, формат и хранение |
| [AGENTS.md](AGENTS.md) | Инструкции работы для следующих агентов |

`main` — локальная исходная ветка; для задачи создавать ветку `work/<task-id>-<short-name>`. Первоначальный commit сохраняет спецификации и рабочую инфраструктуру. Remote, hosting и внешний artifact storage пока не подключены. Все локальные artifacts/runs исключены из Git; это evidence storage, а не резервная копия приватных заявок.
