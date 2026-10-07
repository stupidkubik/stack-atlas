# Рабочий реестр задач

Состояние обновляется через `python3 scripts/worklog.py`. Исходные требования и DoD — в [плане ядра](../14-core-development-plan.md) и профильных планах. Подготовка Git/journal не завершает FP-01.

| ID | Задача / план | Статус | Последний run | Обновлено UTC |
| --- | --- | --- | --- | --- |
| FP-01 | [Воспроизводимый каркас приложения](../plans/01-foundation.md) | verified | 20261005T155307Z-FP-01-371d7ac7 | 2026-10-05T15:58:20Z |
| FP-02 | [Targets, конфигурация и автономные fixtures](../plans/01-foundation.md) | verified | 20261005T175712Z-FP-02-acc2ccc3 | 2026-10-05T18:00:47Z |
| FP-03 | [Базовые миграции, connections и SQL-права](../plans/01-foundation.md) | review | 20261006T065406Z-FP-03-4c8ce817 | 2026-10-06T21:26:21Z |
| FP-04 | [Development аккаунты и проверенные live adapters](../plans/01-foundation.md) | verified | 20261007T121616Z-FP-04-8da015bf | 2026-10-07T12:23:38Z |
| FP-05 | [Единый вертикальный прототип и пересчёт](../plans/01-foundation.md) | planned | — | — |
| CW-01 | [Зафиксировать границы public read и readiness](../plans/02-content-and-public-web.md) | review | 20261006T065345Z-CW-01-f596ec06 | 2026-10-06T06:56:03Z |
| CW-02 | [Реализовать схемы Studio, проверки публикации и seed input](../plans/02-content-and-public-web.md) | review | 20261006T065627Z-CW-02-96b318d1 | 2026-10-06T21:26:21Z |
| CW-03 | [Подготовить прототипный редакционный набор](../plans/02-content-and-public-web.md) | review | 20261006T070821Z-CW-03-1b375c49 | 2026-10-06T21:26:21Z |
| CW-04 | [Собрать и защитить preview workflow](../plans/02-content-and-public-web.md) | review | 20261006T070825Z-CW-04-645883d8 | 2026-10-06T21:26:21Z |
| CW-05 | [Подключить publication webhook и управляемый кеш](../plans/02-content-and-public-web.md) | review | 20261006T070825Z-CW-05-ba2087ed | 2026-10-06T21:26:21Z |
| CW-06 | [Реализовать URL identity, pair routing и rename flow](../plans/02-content-and-public-web.md) | review | 20261006T070826Z-CW-06-1408a237 | 2026-10-06T21:26:21Z |
| CW-07 | [Закрыть прототипную публичную вертикаль](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-08 | [Собрать общий публичный каркас и главную](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-09 | [Реализовать категорию, поиск, фильтры и устойчивое состояние URL](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-10 | [Реализовать страницу CMS и видимые состояния данных](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-11 | [Реализовать редакционное сравнение](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-12 | [Выпустить AI-readiness методологию и UI](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-13 | [Подготовить production editorial content](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-14 | [Завершить SEO, metadata, structured data и технические страницы](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-15 | [Подготовить public web к общей приёмке](../plans/02-content-and-public-web.md) | planned | — | — |
| CW-16 | [Визуальная система и макеты ключевых экранов](../plans/02-content-and-public-web.md) | planned | — | — |
| DP-01 | [Доменные контракты метрик и mappingKey](../plans/03-data-and-collector.md) | review | 20261006T065406Z-DP-01-81ecf1e9 | 2026-10-06T21:26:21Z |
| DP-02 | [SQL-миграции текущих метрик и права таблиц](../plans/03-data-and-collector.md) | review | 20261006T065407Z-DP-02-f5d009a0 | 2026-10-06T21:26:21Z |
| DP-03 | [Чтение и проверка published mapping из Sanity](../plans/03-data-and-collector.md) | review | 20261006T070826Z-DP-03-7240f951 | 2026-10-06T21:26:21Z |
| DP-04 | [Безопасный seed отсутствующих CMS-документов](../plans/03-data-and-collector.md) | review | 20261006T070826Z-DP-04-ee4e81e4 | 2026-10-06T21:26:21Z |
| DP-05 | [Metrics collector и один writer](../plans/03-data-and-collector.md) | review | 20261006T065407Z-DP-05-6c640977 | 2026-10-06T21:26:21Z |
| DP-06 | [Read model метрик, fallback и cache hooks](../plans/03-data-and-collector.md) | review | 20261006T065407Z-DP-06-1baa44b5 | 2026-10-06T21:26:21Z |
| DP-07 | [Чтение опубликованного AI-review и расчёт балла](../plans/03-data-and-collector.md) | review | 20261006T065407Z-DP-07-9d7dfd40 | 2026-10-06T21:26:21Z |
| DP-08 | [Ежедневный запуск collector и восстановление метрик](../plans/03-data-and-collector.md) | review | 20261006T065407Z-DP-08-e4e70dbd | 2026-10-06T21:26:21Z |
| LM-01 | [Закрепить доменные интерфейсы, target selection и безопасные fixtures](../plans/04-leads-consent-and-measurement.md) | review | 20261006T065421Z-LM-01-c63abbce | 2026-10-06T06:58:56Z |
| LM-02 | [Создать lead-схему без email и миграции](../plans/04-leads-consent-and-measurement.md) | review | 20261006T065946Z-LM-02-12e92658 | 2026-10-06T21:26:21Z |
| LM-03 | [Реализовать POST /api/leads и идемпотентность](../plans/04-leads-consent-and-measurement.md) | review | 20261006T072355Z-LM-03-345e64cf | 2026-10-06T21:26:21Z |
| LM-04 | [Реализовать Brevo Contacts adapter и модель обновления контакта](../plans/04-leads-consent-and-measurement.md) | review | 20261006T072355Z-LM-04-8d95606e | 2026-10-06T21:26:21Z |
| LM-05 | [Собрать доступную форму и состояния заявки](../plans/04-leads-consent-and-measurement.md) | review | 20261006T071022Z-LM-05-40f0becf | 2026-10-06T21:26:21Z |
| LM-06 | [Реализовать consent state machine без раннего SDK](../plans/04-leads-consent-and-measurement.md) | review | 20261006T071404Z-LM-06-0650fdc7 | 2026-10-06T21:26:21Z |
| LM-07 | [Добавить event allowlist, атрибуцию и accepted funnel](../plans/04-leads-consent-and-measurement.md) | review | 20261006T072355Z-LM-07-5c99fef0 | 2026-10-06T21:26:22Z |
| LM-08 | [Пройти независимый вертикальный прототип формы и измерения](../plans/04-leads-consent-and-measurement.md) | planned | — | — |
| LM-09 | [Ввести TTL и удаление заявок в Brevo и БД](../plans/04-leads-consent-and-measurement.md) | planned | — | — |
| QA-01 | [CI и единый набор доказательств](../plans/05-quality-operations-and-release.md) | planned | 20261006T151840Z-QA-01-d2637cf4 | 2026-10-06T15:27:17Z |
| QA-02 | [Сквозная приёмка и отказные сценарии](../plans/05-quality-operations-and-release.md) | planned | — | — |
| QA-03 | [Доступность и performance](../plans/05-quality-operations-and-release.md) | planned | — | — |
| QA-04 | [Maintenance, расписание и restore rehearsal](../plans/05-quality-operations-and-release.md) | planned | — | — |
| QA-05 | [Production подготовка и release gate](../plans/05-quality-operations-and-release.md) | planned | — | — |
| QA-06 | [Публичный кейс и закрытие v1](../plans/05-quality-operations-and-release.md) | planned | — | — |
