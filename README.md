# PkgCompass

Каталог headless CMS для JS/TS-сайтов. Начат первый проход foundation: воспроизводимый каркас, автономные fixtures и базовые миграции. Фактическое состояние задач — в [рабочем реестре](docs/work/tasks.md); внешние интеграции и готовность каталога пока не подтверждены.

## Начало работы

1. Прочитать [реестр решений](docs/00-start-decisions.md), [продуктовую рамку](docs/02-product-and-scope.md) и [план ядра](docs/14-core-development-plan.md).
2. Выбрать задачу в [рабочем реестре](docs/work/tasks.md), проверить её зависимости и DoD в детальном плане.
3. Создать запись работы: `python3 scripts/worklog.py start FP-01 --summary "Начало каркаса приложения"`.
4. Добавлять результаты проверок и завершить запись по [рабочему процессу](docs/work/README.md).

Для рабочего журнала нужен Python 3.9+ (standard library, macOS/Linux). Команды приложения и результаты проверки воспроизводимости добавляются ниже по завершении FP-01. CI относится к QA-01.

## Версии foundation

Stable-версии сверены 5 октября 2026 по официальным документациям и публичным npm metadata. Точные зависимости фиксирует `package-lock.json`; runtime — `.nvmrc` и `package.json`.

| Компонент | Выбор | Причина |
| --- | --- | --- |
| Node / npm | 24.18.0 / 12.0.2 | Доступная локальная пара, удовлетворяет engines выбранных инструментов |
| Next.js / React | 16.3.8 / 19.3.0 | Stable App Router; совместимые peer dependencies |
| TypeScript | 6.0.3 | Latest 7.0.2 выходит за поддерживаемый диапазон typescript-eslint `<6.1.0` |
| Sanity | 6.17.0 | Требует Node ≥22.12 и React 19; подходит выбранному runtime |
| Tailwind | 4.3.3 | PostCSS integration |
| ESLint / Next plugin | 10.12.0 / 16.3.8 | Прямой flat config с TypeScript и React Hooks; bundled React-плагин eslint-config-next несовместим с ESLint 10 |
| Vitest / Vite | 5.0.3 / 8.3.2 | Совместимые Node engines и peers |
| Playwright | 1.63.0 | Браузерные проверки устанавливаются с появлением сценариев |

Источники: [Node releases](https://nodejs.org/en/about/previous-releases), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Sanity requirements](https://www.sanity.io/docs/studio/installation), [typescript-eslint dependencies](https://typescript-eslint.io/users/dependency-versions/), [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro).

## Локальное приложение

```sh
nvm use
npm ci
npm run lint
npm run typecheck
npm run build
npm run start
```

Стартовая страница — `/en/`, `/` перенаправляет на неё. Пока это закрытый от индексации предварительный экран; каталог, форма и live CMS не готовы. `npm run dev` запускает Next.js для разработки. Для каркаса `.env` и внешние аккаунты не нужны.

`npm run studio` и `npm run studio:build` требуют выделенных `SANITY_STUDIO_PROJECT_ID` и `SANITY_STUDIO_DATASET`. Эти два значения публичные, секретные токены в Studio не передаются. Схемы относятся к CW-01; live Studio smoke ещё не выполнен.

Vitest и Playwright настроены. До появления сценариев пустой запуск `test` / `test:e2e` не считается пройденной проверкой. Для E2E требуется `PKGCOMPASS_RUN_ID` текущего run: traces сохраняются в его `evidence/playwright/`. Отчёты не размещаются в tracked files.

## Документы и результаты

| Путь | Назначение |
| --- | --- |
| [docs/README.md](docs/README.md) | Контракты v1 и приоритет решений |
| [docs/14-core-development-plan.md](docs/14-core-development-plan.md) | Порядок исполнения и пять детальных планов |
| [docs/work/tasks.md](docs/work/tasks.md) | Текущие статусы 44 задач |
| [docs/work/journal/](docs/work/journal/README.md) | Очищенная история работы по дням |
| [artifacts/README.md](artifacts/README.md) | Локальные evidence runs, формат и хранение |
| [AGENTS.md](AGENTS.md) | Инструкции работы для следующих агентов |

`main` — локальная исходная ветка; для задачи создавать ветку `work/<task-id>-<short-name>`. Первый проход выполняется в `work/foundation-first-pass`. Remote, hosting и внешний artifact storage пока не подключены. Все локальные artifacts/runs исключены из Git; это evidence storage, а не резервная копия приватных заявок.
