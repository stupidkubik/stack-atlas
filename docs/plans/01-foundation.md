# Основание проекта и интеграционный прототип

Дата: 5 октября 2026. Статус всех задач: запланировано. Код и аккаунты этим документом не создаются. Источники требований: [архитектура](../05-architecture.md), [продукт](../02-product-and-scope.md), [приёмка](../11-quality-plan.md), [эксплуатация](../12-operations.md). Приоритет требований остаётся у [ADR 0013](../decisions/0013-marketing-v1-and-simple-pipeline.md) и спецификаций 02–12.

## FP-01 — Воспроизводимый каркас приложения

**Вход:** принятый стек; зависимостей от других задач нет.

1. При реализации проверить официальную документацию и совместимость стабильных Node/npm, Next.js/React, Sanity, Drizzle, Vitest/Playwright; выбрать версии без canary. Записать версии и причины ограничений, создать и закоммитить lockfile. План не закрепляет непроверенные номера версий.
2. Создать один npm-репозиторий с TypeScript strict, App Router, Tailwind, Studio и CLI. Использовать структуру из 05 §6; domain не импортирует SDK, Next.js или env.
3. Подготовить ESLint, typecheck, минимальный build, Vitest и Playwright config. Тестовые инструменты устанавливать по мере появления проверяемых сценариев; не писать тесты существования файлов.
4. Дополнить существующие `.gitignore` и root README, добавить `.env.example` без значений и Node version pin; описать локальные prerequisites и реально проверенные команды приложения. Локальный Git-репозиторий и tooling рабочего журнала уже подготовлены; remote и visibility настраиваются отдельно. FP-01 остаётся planned до появления приложения/lockfile/build и полного DoD.

**Артефакты:** package manifest/lockfile, каркас `src/`, `studio/`, `scripts/`, конфиги и README приложения. Пути будущего кода здесь и далее — предлагаемые, не существующие файлы.

**Готово, когда:** из чистого checkout выполняются `npm ci`, lint, typecheck и production build; версии закреплены; секретов в tracked files и bundle нет. Это основание CI, а не закрытие Q01–Q19.

## FP-02 — Targets, конфигурация и автономные fixtures

**Зависимость:** FP-01. Выполняется до live-запросов любых потоков.

1. Реализовать типизированный server config по 05 §4: APP_ENV выбирает согласованные CMS/SQL/CRM/analytics targets. Валидировать необходимые переменные при старте соответствующего компонента, выводить только безопасную причину ошибки. Public env экспортировать явным allowlist.
2. Local/CI/untrusted PR используют synthetic CMS, fake CRM, stub analytics, API fixtures и временный PostgreSQL. Trusted preview использует development. Production targets не подставляются автоматически при отсутствии dev-конфига.
3. Подготовить общие synthetic IDs, фиксированные UTC часы и fixtures: пять CMS, scoped SDK, monorepo, продукт без SDK, draft, rename, одна пара, полный/неполный AI-review. Fixtures не содержат реальные email, секреты или приватный draft text.
4. Определить интерфейсы repositories/adapters для CMS, чтения и записи метрик, CRM и measurement. Подмена live/fake задаётся конфигурацией entry point; доменные функции остаются чистыми. Не строить универсальный plugin framework.
5. Добавить safe error/log/report convention: status/code/environment/run UUID допустимы, тела заявок, IP, токены, full query и credential requestId в публичных логах запрещены. Обработать отсутствие CMS как 503 при отсутствии кеша, отсутствие SQL — как недоступность метрик без потери редакционного контента.

**Артефакты:** config/adapters, fixture dataset и adapter selection, таблица targets без секретных значений в README.

**Готово, когда:** offline app/test path не делает внешних запросов; неверная конфигурация не переключает среду; fixture IDs согласованы во всех потоках; server secrets не доступны клиенту. Поддерживает Q05, Q08, Q13–Q17.

## FP-03 — Базовые миграции, connections и SQL-права

**Зависимости:** FP-01, FP-02. Детальные схемы метрик и заявок принадлежат DP/LM; здесь задаётся единый механизм миграций.

FP-03 выполняется в два прохода: сначала runner/connections/пустые роли для начала DP/LM, затем GRANT и отрицательные role tests после появления таблиц. Зависимость DP/LM от FP-03 означает доступность первого прохода, а не ожидание готовых таблиц; это исключает цикл между baseline и доменными миграциями.

1. Поднять локальный/временный PostgreSQL и Drizzle migration runner с явным `--env`. Разделить pooled web connections и direct session для migrations/collector lock.
2. Создать роли public metrics reader, collector metrics writer, lead writer и migration owner. После появления таблиц из DP/LM применить GRANT, включая запрет public/collector доступа к private leads; не полагаться на naming или приложение вместо SQL-прав.
3. Ввести порядок применения миграций, схему миграционного журнала инструмента, проверку migration history и чистой базы. Это не collector ledger. Не создавать самостоятельную роль AI-review.
4. Write CLI требует явный environment, production — также `--allow-production`; применимость к deploy-targeted handlers оговорена в 12. Dry-run не получает неявный apply.
5. Установить правило совместимых миграций: при релизе сначала добавляем совместимую схему, затем код; удаление/изменение данных — отдельная задача с backup. Откат приложения не обещает откат CMS/CRM/SQL.

**Артефакты:** migration runner, bootstrap roles/GRANT, connection factories, пустая база для integration CI; README с проверенными командами.

**Готово, когда:** после добавления DP/LM migrations одна последовательность поднимает схему с нуля; повтор не изменяет данные; каждая роль реально проверена положительным и запрещённым SQL-запросом. Q09/Q13/Q17; полная restore-проверка — QA-04.

## FP-04 — Development аккаунты и проверенные live adapters

**Зависимости:** FP-02 и первый проход FP-03 для provisioning. Полный live smoke требует доменных CW/DP/LM схем и второго прохода FP-03 с GRANT. Работу по созданию targets можно начать после FP-02 параллельно схемам.

Сначала создать targets/credentials (шаги 1–3); это вход для live частей DP-03–DP-07, CW и LM. Затем вместе с adapters выполнить smoke/сохранить fixtures (шаги 4–5) и закрыть полный DoD FP-04. Зависимость потока от FP-04 означает готовность targets, а не ожидание smoke, который проверяет этот же поток.

1. Создать Sanity development dataset, Neon development schema-only branch, отдельный Brevo requests dev list и PostHog EU dev project. Studio и web/CLI должны указывать на один dev target. Production private rows не копировать.
2. Проверить текущие account quotas, регионы, права и совместимость API по официальным источникам во время настройки; сохранить дату и безопасную сводку. Включить бюджет Actions, лимиты Vercel Cron и проверку разрешённого использования hosting. Не считать все интеграции бесплатными по умолчанию. Платная функция требует конкретного предложения и разрешения на расход.
3. Выдать раздельные credentials из 05/12, настроить signed webhook, preview credential, CRM attributes и отключённые campaigns, consent-only analytics config, `CRON_SECRET` и fine-grained `GITHUB_DISPATCH_TOKEN`. Проверить, нужно ли включать workflow через API перед `workflow_dispatch`, и условия некоммерческого использования Vercel Hobby. Секреты хранить в выбранных secret stores, не в документации.
4. Использовать выделенный тестовый alias владельца только для development заявки; повторно не применять его в production. Проверить live mapping 3–5 CMS, сохранять только очищенные fixtures с датами/версиями источников.
5. Записать фактические CLI-команды, target identifiers без секретов и подтверждённые ограничения аккаунтов. Ошибки доступа устранять в прототипе, не отмечать smoke пройденным на fake adapters.

**Артефакты:** dev target inventory, secret-name inventory, sanitized fixtures, live smoke evidence. Аккаунты не считаются подключёнными до этих шагов.

**Готово, когда:** команды явно выбирают dev; publisher/preview/collector/CRM/analytics работают на собственных targets; production credentials отсутствуют в PR; стоимость/лимиты зафиксированы. Связано с Q05–Q09/Q11/Q13–Q16/Q17.

## FP-05 — Единый вертикальный прототип и пересчёт

**Зависимости:** FP-04, CW-07, минимальные DP-05–DP-07 и LM-08. Детальный состав прототипа перечислен в [общем плане](../14-core-development-plan.md).

1. На 3–5 CMS и одном сравнении показать: seed → draft → preview → publish → server HTML, metadata и обновление связанных страниц без deploy.
2. Выполнить collect метрик → read model → отображение дат и спарклайна; опубликовать AI-review в Studio и увидеть его на сайте после webhook; вызвать partial source failure, смену источника и новый run после crash; проверить last-valid и lock busy.
3. С comparison открыть форму. Проверить dev Brevo accepted, потерянный ответ и повтор, отказ CRM и DB; при no-consent успешной форме в сети нет analytics.
4. Отдельно при granted пройти comparison → form → accepted; показать событие в dev PostHog и отсутствие PII. Отозвать согласие, дождаться отложенного callback и проверить reload.
5. Записать прототипный отчёт с commit, версиями, Q-кодами, реальными и fake доказательствами отдельно. Не требовать от прототипа полного контента/дизайна или release performance, но критические security/correctness нарушения устранить до расширения каталога.
6. Пересчитать гипотезу 64–106 часов из 05 по фактическим затратам, оставшимся задачам и ограничениям. Указать уже потраченное и остаток раздельно; не суммировать прототип повторно с завершением функций. Сначала сокращать до пяти CMS/трёх сравнений и визуальные детали; обязательные CRM/consent/SEO/защиты остаются.

**Артефакты:** воспроизводимый прототипный сценарий, evidence index, обновлённая оценка остатка и список конкретных дефектов.

**Готово, когда:** вертикальный путь подтверждён на live dev интеграциях; тесты отказов воспроизводимы; опасные дефекты закрыты; оставшаяся работа имеет обновлённый порядок. Gate прототипа не равен разрешению на production release.
