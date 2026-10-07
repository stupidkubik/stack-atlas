# PkgCompass: реестр решений и старт реализации

Дата: 5 октября 2026. Актуальная рамка — [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) с упрощениями учебного v1 из [ADR 0014](decisions/0014-learning-project-simplifications.md). Открытых продуктовых/архитектурных решений, блокирующих начало реализации, нет. Это не подтверждение готовности приложения к релизу.

## 1. Принятые решения

| Решение | Источник |
| --- | --- |
| PkgCompass, каталог headless CMS, product отдельно от SDK/repository | ADR 0002 и 02 |
| English-only v1, document-level content locale и /en/ URLs; карточка `/en/tools/{slug}/`, сущность `product` | ADR 0001/0008/0009, 0014 |
| 5–8 CMS и 3–5 содержательных сравнений | ADR 0005/0006 и актуальный 0013 |
| CMS/SEO/доступность + форма→CRM + consent/аналитика в v1 | ADR 0013, 02, 09, 10 |
| AI-readiness: types/llmsTxt/MCP, веса 25/20/20, знаменатель 65, ручной review читается из Sanity, свежесть 90 дней | ADR 0002/0013/0014 и 07 |
| Next.js, Sanity, Vercel Hobby, Neon PostgreSQL, Actions CLI с ежедневным запуском через Vercel Cron | ADR 0003/0007/0010/0012 с уточнениями 0013/0014 |
| Ограниченный collector, один writer, только текущее состояние метрик | ADR 0013/0014 и 06 |
| Brevo Contacts API (единственное хранилище email), PostHog Cloud EU, accepted lead conversion | ADR 0013/0014, 09, 10 |
| Drizzle/migrations; Tailwind; Vitest/Playwright/axe/Lighthouse | 05; defaults реализации |
| UI: светлый каталог с редакционными элементами; визуальная система и макеты — задача CW-16 | ADR 0011/0014 |
| Изоляция dev/prod сразу, заявки отдельно от публичных метрик | 05/12 |
| Хранение: метрики — только текущее состояние; заявки 30 дней; аналитика 90 дней; отчёты 14 дней; backup — только CMS export | 06/09/10/12 |
| Публичный репозиторий к портфолио-релизу, private development допустим; без secrets/PII | ADR 0013 |
| Переводы, A/B, newsletter/DOI, агенты/расширения позже | 02/10 |

Исторические ADR не отменяются целиком; заменённые пункты помечены и при конфликте уступают 0013 и 0014. Реестр не создаёт вторую независимую спецификацию.

## 2. Первая реализационная задача

Детальный порядок исполнения, задачи и зависимости собраны в [плане ядра](14-core-development-plan.md) и его пяти разделах. FP-01 и FP-02 выполнены и независимо проверены. После остановки на FP-02 владелец поручил второй проход: migration baseline FP-03 и подготовку development targets FP-04. Актуальные статусы — в [рабочем реестре](work/tasks.md).

Локальный Git-репозиторий, [рабочий реестр и журнал](work/README.md), [artifact storage](../artifacts/README.md) подготовлены. Создан минимальный App Router каркас с закреплёнными версиями и lockfile; clean install/lint/typecheck/build и production browser smoke проверены. Это не готовый каталог и не live прототип. GitHub remote и Next.js Vercel Preview подключены; внешнее хранилище artifacts пока не подключено.

Первый проход FP-03 подготовлен и проверен на временном PostgreSQL: runner, connection boundaries и пустые роли. Полный DoD FP-03 требует доменных migrations и GRANT. В проходе FP-04 5–6 октября проверены dev API reads Sanity, authentication Neon roles, настоящий Brevo adapter upsert/repeat/cleanup, account inventory и границы credentials; независимое review проведено. В продолжении 6 октября реализованы CW/DP/LM consumers, применены четыре domain migrations и проверены права четырёх ролей. На development проверены publisher/preview/webhook и collector пяти CMS. Полный FP-04 остаётся blocked на разрешении live API формы/Brevo и полного PostHog smoke, а также публикации workflow/dispatch credential. Изолированный consent smoke проходит; это не live ingestion. Точная приёмка и следующие действия — в [отчёте прохода](work/journal/2026-10-06-fp04-review.md).

Регистрации, названия ключей, места хранения и датированные публичные условия собраны в [development services](setup/development-services.md). Аккаунты/фактические квоты/host/list IDs и live API fixtures фиксируются при настройке; справочник не подтверждает подключение сервисов. Нет необходимости повторно согласовывать framework, CRM, методологию или смысл конверсии. Если конкретный account требует оплату, подготовить конкретный вариант/цену и запросить разрешение на расход; не заявлять проверку выполненной без доступа.

## 3. До публичного выпуска

Production targets, origin (Vercel URL достаточен), contact владельца, quota/budget, live CMS/CRM/analytics smoke, Q01–Q19, isolated backup/restore и deletion, реальные команды в README. Подробная приёмка — [11](11-quality-plan.md); эксплуатация — [12](12-operations.md).

Документационных блокеров нет; перечисленные проверки — обязательные задачи исполнения. Фактические ошибки/непройденные gates по-прежнему могут блокировать релиз. Нельзя заменить проверку аккаунтов фразой «без блокеров».
