# PkgCompass: полный план разработки ядра v1

Дата: 5 октября 2026. **Статус: реализация начата; фактические статусы — в [рабочем реестре](work/tasks.md).** Локальный Git-репозиторий, [журнал](work/README.md) и [хранилище evidence](../artifacts/README.md) подготовлены. FP-01 дала минимальный каркас и committed lockfile с проверенным clean build; внешние интеграции и вертикальный прототип ещё не подтверждены. План не выполняет публикацию.

## 1. Результат и границы

Результат разработки — английский каталог headless CMS с 5–8 продуктами и 3–5 содержательными сравнениями. Редактор публикует через Sanity; посетитель получает доступную SSR/SEO-страницу, проверяет источники и отправляет Request a CMS shortlist; Brevo подтверждает запись, PostHog EU измеряет путь только после analytics consent. Collector обновляет snapshots, при сбоях сохраняется честный last-valid. Production изолирован, private leads защищены, восстановление проверено.

Обязательный минимум контента — пять CMS (Sanity, Contentful, Strapi, Payload, Directus) и три сравнения; расширение до восьми/пяти только при готовой редактуре. AI-review ручной, три сигнала и прозрачная методология обязательны. Не добавляем переводы, A/B, newsletter/DOI/автописьма, общий рейтинг, универсальный builder, ledger/receipts/pointers/resume, публичный data API и пустые модули будущих функций.

Источник требований — [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md), [ADR 0014](decisions/0014-learning-project-simplifications.md) и [спецификации 02–12](README.md). Этот пакет задаёт работу, зависимости и доказательства; поля/формулы/HTTP/retention остаются в исходных контрактах. Если реальная интеграция требует изменения контракта, оформить следующий ADR и обновить связанные документы вместе с планом.

## 2. Пакет детальных планов

| План | Задачи и ответственность |
| --- | --- |
| [01 Основание](plans/01-foundation.md) | FP: bootstrap, конфигурация/fixtures, SQL-права, dev targets, интеграционный прототип |
| [02 CMS и публичный web](plans/02-content-and-public-web.md) | CW: модель, Studio, readiness, preview/cache, визуальная система, UI/SEO и редакционный контент |
| [03 Данные и collector](plans/03-data-and-collector.md) | DP: mapping, seed, текущие метрики, adapters, чтение AI-review, fallback, ежедневный запуск |
| [04 Заявки и измерение](plans/04-leads-consent-and-measurement.md) | LM: заявки без email, Brevo, форма, consent, события/атрибуция/воронка |
| [05 Качество и выпуск](plans/05-quality-operations-and-release.md) | QA: CI/evidence, приёмка, доступность/performance, restore/operations, production и кейс |

Для каждой задачи задан результат, входы/зависимости, шаги, артефакты и проверяемый DoD. Предложенные code paths не являются уже существующим кодом. Идентификатор задачи — устойчивый ключ для issue/PR/evidence; название можно уточнять без смены ID. Новые нормативные решения в issue не прятать.

## 3. Порядок и контрольные точки

| Этап | Работа | Условие выхода |
| --- | --- | --- |
| M0 — воспроизводимое основание | FP-01–FP-03, начать QA-01; общие IDs/domain interfaces, fixtures и миграции | Clean checkout/build, offline CI path, явные targets, базовые роли; без live-запросов в PR |
| M1 — интеграционный прототип | FP-04, прототипные CW/DP/LM задачи параллельно, затем FP-05 | 3–5 CMS + одна пара; live CMS/preview/webhook, metrics/fallback/AI, Brevo accepted/retry, consent/PostHog; исправлены критические дефекты |
| M2 — полный v1 | Остальные CW/DP/LM задачи и полный контент; QA-01–QA-03 развиваются вместе с функциями | Все страницы/состояния, 5–8 CMS/3–5 сравнений, dashboard, operations paths; нет placeholders обязательных функций |
| M3 — готовность к эксплуатации | QA-02–QA-04, production подготовка QA-05 | Q01–Q19 evidence, restore/deletion, quotas/privacy/origin, изоляция и runbook подтверждены |
| M4 — разрешённый выпуск и кейс | Финальные шаги QA-05, QA-06 | Deployment smoke, безопасный публичный репозиторий/кейс, фактический статус и ограничения |

Маркетинговый путь входит в M1. Нельзя ждать завершения всего каталога или коллектора, чтобы впервые проверить форму и аналитику. Разные потоки M1 интегрируются на одном fixture/live dev наборе, а не остаются тремя несвязанными демо.

Конкретный состав M1: CW-01–CW-07, минимальные DP-01–DP-07, LM-01–LM-08, dev targets FP-04 и объединение FP-05. CW-16 (визуальная система и макеты) идёт параллельно M1 и должна быть закрыта до CW-08. CW-12 даёт минимальный методологический UI уже в прототипе, его полный DoD закрывается в M2. M2 доводит CW-08–CW-15, DP-08 и LM-09, а также неполные v1 критерии прототипных задач. Во всём пакете **44 задачи**: 5 FP, 16 CW, 8 DP, 9 LM и 6 QA.

Критическая цепочка: FP-01 → FP-02 → FP-03 + первые схемы → FP-04 → FP-05 → доведение/приёмка → restore и production gates → выпуск. Подготовка Studio/UI, источников и lead/consent после общих interfaces может идти одновременно. Live smoke по общему dev namespace выполняется последовательно, чтобы не менять seed конкурентно.

FP-03 сначала предоставляет migration runner/connections/пустые роли, затем после доменных миграций проверяет GRANT. Local/fake задачи потоков начинаются до FP-04; их live dev части требуют FP-04. FP-05 собирает уже проверенные прототипные части, поэтому отдельные CW/DP/LM задачи не должны зависеть от завершённого FP-05. Complete UI строится на fixtures; готовый production контент требуется итоговой приёмке, а не началу разработки шаблонов.

## 4. Межмодульные границы и порядок интеграции

| Граница | Производитель → потребитель | Что согласовать до интеграции |
| --- | --- | --- |
| CMS entity/content | CW → DP/public UI | Stable published IDs, mapping projection, readiness; common entity публикуется до locale content без цикла prerequisites |
| Mapping/AI | CW/Studio ↔ DP → CW/UI | Один алгоритм semantic mappingKey; read layer читает опубликованный aiReview из Sanity; mapping_changed и неполный review не дают score |
| Metrics read model | DP → CW | Последняя попытка и last-valid по источникам, ряд загрузок по дням; mapping/status/date/null/0; no data и SQL failure различимы |
| Cache | CW handlers ↔ DP CLI | Environment/product allowlist, отдельный import secret, webhook signature, server-computed tags, idempotent invalidation и TTL fallback |
| Lead accepted | LM/server → LM/UI/measurement | Accepted только после CRM success; conversionId отличается от request credential; чужой duplicate/honeypot analyticsEligible = false |
| UI events | CW/LM UI → LM measurement | Stable IDs, routeType/entryPoint enum; raw URL/query/referrer/form values не передавать |
| Operations | DP/LM → QA | Один migration history, раздельные роли, dry-run/production guard, collector lock, ежедневный запуск через Vercel Cron, safe reports, CMS export |

Сначала оформить минимальные TypeScript интерфейсы и fixtures, затем подключить producers/consumers, затем провести реальный smoke. Общие утилиты ID/UTC/validation не копировать между потоками. Любое изменение интерфейса сопровождается обновлением consumer и сценария проверки в той же интеграционной задаче.

## 5. Как вести исполнение

Локальный [board](work/tasks.md) по ID из пакета создан; ведение run/evidence и журнала — по [рабочему процессу](work/README.md). Состояния `planned → in_progress → review → verified`, при препятствии `blocked` с конкретной причиной/следующим действием. Фактические статусы хранит board; подготовка репозитория сама по себе не закрывает FP-01. При подключении remote issues переносить те же ID, не создавать независимые противоречивые статусы. Область ответственности назначается исполнителю при старте задачи; автор не заменяет независимую проверку критического поведения.

Evidence-файлы в run обязательны только для проверок, привязанных к Q-гейту (`--gate Qxx`); для остальных задач достаточно записей `check` с командой и результатом. Это учебный проект: процесс не должен стоить дороже кода.

Каждый PR содержит цель задачи, связанный контракт, изменённое поведение, проверки и ограничения. Объём PR — одна проверяемая функциональная часть; нельзя объявить задачу verified только по наличию файлов. Domain/DB/handler tests появляются с функциями; live account/API checks записываются отдельно от mock CI. Критические failures из Q05/Q09/Q13–Q17 устраняются до расширения контента.

После M1 пересчитать оценку [05 §7](05-architecture.md#7-оценка-реализации): 64–106 часов — исходная гипотеза одного React/TS-разработчика, не срок и не сумма оценок субагентов. Не давать календарный дедлайн до фактической проверки интеграций и доступности исполнителя. Уже выполненный прототип не считать второй раз при оценке оставшихся CW/DP/LM задач.

Перед M3 провести единый walkthrough visitor/editor/collector/operator, сверить Q01–Q19 и дефекты. Выпуск блокируется непроверенным live path/restore или нарушением контракта, даже если отдельные PR прошли CI. Планирование не требует создания платных аккаунтов, отправки сообщений или публикации сейчас.

## 6. Риски и действия

| Риск | Когда проверяем | Действие |
| --- | --- | --- |
| Несовместимые SDK/Next cache/preview APIs | FP-01, CW прототип, FP-05 | Pinned stable versions, официальные docs при реализации, live publish/guest-denial тест до полного UI |
| Квоты/регион/недоступная функция account | FP-04, QA-05 | Факт и дата проверки, разрешённый эквивалент в том же контракте; отдельное согласование конкретного расхода |
| npm окно/ошибочный product→SDK mapping | DP прототип | Live 3–5 CMS, очищенные fixtures; incomplete_period/last-valid и редакторское подтверждение |
| Гонка CRM/потерянный ответ/дубли | LM прототип | Идемпотентный upsert, условный переход в accepted, частичный unique index, retry того же requestId и fault tests |
| SDK собирает defaults/после withdrawal | LM прототип и QA-02 | Explicit config, runtime allowlist, network/storage/late-callback проверки pinned SDK |
| Cron перестал запускаться | DP-08, QA-04 | Vercel Cron → `workflow_dispatch`, без `schedule` в Actions; свежесть метрик видна в UI |
| Контент растягивает сроки | M1→M2 | Начать редактуру параллельно прототипу; пять CMS/три качественные пары вместо расширения объёма |
| Restore не работает | QA-04 | Изолированный rehearsal: CMS export, миграции с нуля, новый сбор метрик, запрет public role на заявки |
| Разные даты/mapping/readiness в UI и SEO | Интеграция потоков, QA-02 | Общие domain functions/read layer и fixtures, единственный guard, сравнение HTTP/HTML/sitemap |

## 7. Сводная матрица приёмки

Итоговым владельцем сверки является QA-02; профильные задачи предоставляют доказательства. Статус всех проверок сейчас — **не выполнено**.

| Gate | Реализация / профильная проверка | Итоговое доказательство |
| --- | --- | --- |
| Q01 | CW-09, CW-15 | Desktop/mobile E2E поиска/фильтров/reset/Back |
| Q02 | CW-02, CW-10, CW-11, CW-13 | Domain validation и редакционный review |
| Q03 | CW-06, CW-14 | HTTP матрица rename/pair/query/locale/readiness |
| Q04 | CW-14 | SSR metadata/JSON-LD и sitemap assertions |
| Q05 | CW-01, CW-04, CW-07 | Две сессии; guest denied; draft отсутствует во всех public поверхностях |
| Q06 | CW-05, DP-06 | Signature/repeat/publish/unpublish/rename, real latency ≤60s |
| Q07 | DP-04, CW-02 | Seed repeat/editorial preservation, dry-run no mutation |
| Q08 | DP-01, DP-03, DP-05, CW-10 | Fixture source windows/mapping/0/null и live 3–5 CMS |
| Q09 | DP-05, DP-06, DP-08 | Lock busy/crash/partial/error, last-valid в DB/UI, ежедневный запуск |
| Q10 | DP-08, QA-04 | Isolated restore: CMS export, миграции, новый сбор |
| Q11 | DP-07, CW-12 | Formula/evidence/completeness, official/community, mapping_changed, свежесть 90 дней |
| Q12 | LM-02, LM-03, LM-05, LM-08 | Server validation, permission, honeypot/rate limit, доступная форма |
| Q13 | LM-02–LM-04, LM-08 | DB/fake CRM races, timeout/lost reply и live dev accepted |
| Q14 | LM-03, LM-05–LM-08, QA-02 | No-consent CRM success; false success исключён |
| Q15 | LM-06, LM-08, QA-02 | Network/storage unknown/denied/granted/withdraw/reload/late callback |
| Q16 | LM-01, LM-06–LM-08, QA-02 | No-PII schema, UTM allowlist, dedupe, synthetic funnel + real dashboard |
| Q17 | FP-03, LM-02, LM-09, QA-04 | Нет email в БД, удаление по сроку в Brevo/БД и реальные SQL role/target запреты |
| Q18 | CW-15, QA-03 | axe + ручной критический путь VoiceOver/keyboard/reflow |
| Q19 | CW-15, QA-03, QA-05 | Pinned Lighthouse budget и production HTTP smoke |

## 8. Готовность плана и старт

Продуктовых развилок для начала нет. Первый исполнимый шаг — FP-01; затем общие config/interfaces/fixtures и migration baseline, после них три прототипных потока. Аккаунты, API fixtures, точные версии, макеты и команды — задачи реализации с конкретным DoD.

Полный v1 закончен только после всех обязательных задач, Q01–Q19, реальных интеграций, restore/deletion и release smoke. Следующая итерация (переводы, затем A/B; подписка как отдельный продукт) получает отдельный план после работающего ядра.

## 9. Шаблон карточки исполнения

При переносе задачи в tracker использовать её ID и ссылку на детальный раздел:

```text
ID / название:
Статус: planned
Исполнитель / проверяющий:
Этап M0–M4:
Контракт и обязательные входы:
Зависимости и доступный минимальный интерфейс:
Результат / артефакты:
DoD и Qxx:
Проверка: commit, environment, команда, pass/fail, safe evidence
Фактические ограничения / дефекты:
Следующее действие:
```

При блокировке указывать, что именно недоступно (target, credential, API или тест), кто устраняет и какую независимую задачу можно продолжать. Различать доступность интерфейса для параллельной разработки и полное закрытие задачи: иначе общий migration baseline или контент создают искусственные циклы.

## 10. Проверка пакета планов

Пакет сверяется с актуальными 02–12, ADR 0013 и ADR 0014: обязательные CMS/SEO/форма/consent/измерение включены в прототип, исключённые возможности не стали задачами v1. Seed CLI принадлежит DP-04, cache handlers — CW-05, read model метрик — DP-06, чтение AI-review — DP-07, дизайн — CW-16, заявки без email — LM, итоговая приёмка/выпуск — QA. Проверки задачи и общий gate используют одни evidence, а не считаются повторной реализацией функции.

Проверены локальные ссылки, уникальность ID 44 задач, наличие артефактов и DoD, таблицы и формат Markdown. Граф явных предшественников проверяется отдельно от пояснений о более поздней интеграции. Исправлены циклические трактовки content/templates, schema/seed, environment/smoke и production targets/release; многошаговые handoffs явно описаны в FP-03, FP-04 и QA-05.

Эта проверка подтверждает структуру плана. Внешние аккаунты, текущие API/версии, команды, макеты и Q01–Q19 ещё предстоит проверить при реализации; все их текущие статусы остаются «не выполнено».
