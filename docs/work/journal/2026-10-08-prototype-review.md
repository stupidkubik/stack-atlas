# Прототип PkgCompass: срез приёмки 8 октября 2026

**Функциональный сквозной development-прототип проверен; LM-08, CW-07 и FP-05 переданы в review.** Реальные CMS → HTML/webhook, CMS → форма → CRM и granted → PostHog проверки прошли. Полное `verified` пока не заявляется: буквальный пункт LM-08 о fake browser path в CI ещё не выполнен, итоговая независимая приёмка новых live evidence остаётся открытой. Это не разрешение production release.

Текущие runs: LM-08 `20261007T213134Z-LM-08-6b11ee36`, CW-07 `20261007T222438Z-CW-07-b9dafb8a`, FP-05 `20261007T222603Z-FP-05-df443d16`. Проверяемые DoD — [FP-05](../../plans/01-foundation.md), [CW-07](../../plans/02-content-and-public-web.md), [LM-08](../../plans/04-leads-consent-and-measurement.md); фактический реестр — [tasks](../tasks.md). Локальные отчёты перечислены в [evidence index](../../../artifacts/runs/20261007T222603Z-FP-05-df443d16/evidence/prototype-evidence-index.md).

## Исходники, версии и deployment

Базовый commit: `30a8e817`; рабочее дерево содержит незакоммиченные изменения. Финальный source snapshot: `c5ee03c3b6b5a90004fcc43eb03ba45437e61f42e980aa5039d8f3316401a347`, Preview `dpl_BGgsi6jNthP39MWBkxUgJBBA8ys8`, **READY**. Это снимок dirty source, а не Git commit. На нём прошли изолированные draft/preview/publish/update/unpublish/rename проверки. Studio AI-review UI проверен на предыдущем снимке `5887f484`, Preview `dpl_3rVtyZsPeEP4y5DUcjm6x3km9Lcq`; последующий код изменил обработку rename, не Studio. Более ранний Preview `dpl_CiyEyVPUshbrwnJLwN9Tyi8GPXff` прошёл HTTP metadata и независимый fake browser form/consent smoke; Vercel toolbar заблокирован отдельно (11 попыток, 0 отправлено).

По отдельному запросу владельца реализация зафиксирована локальными коммитами: `96522d1` (данные/AI-validation/cache refresh), `472cf1a` (форма/consent/funnel), `6e87d4d` (embedded Studio), `2cfc1aa` (публичная CMS-вертикаль/SEO/rename). Эти commits фиксируют уже проверенный код; live evidence выше сохраняет исходные snapshot/deployment identifiers. Push не выполнялся. Перед фиксацией повторно прошли 295 tests (13 live-gated skips), lint, typecheck и diff whitespace check; проверка 49 изменённых/новых файлов не нашла точных private credential values или raw artifacts.

Закреплённые версии: Node `24.18.0`, Next.js `16.3.8`, React `19.3.0`, Sanity Studio `6.17.0`, PostHog JS `1.436.1`, Vitest `5.0.3`, Playwright `1.63.0`. Локальный Next build через webpack и Sanity Studio build прошли. Turbopack локально завершился ошибкой sandbox bind; remote Next build прошёл. Это разные результаты, а не общий pass обоих локальных bundlers.

## Что подтверждено

| Область | Фактический результат | Тип доказательства |
| --- | --- | --- |
| Общая регрессия | 295 тестов прошли, 13 live-gated пропущены; lint и typecheck прошли | Локальные tests/source review; skips не являются live pass |
| SSR публичных страниц | Home использует authored sections и featured IDs; категория фильтрует membership IDs; methodology показывает опубликованные sections и нормативную формулу; canonical/OG/JSON-LD согласованы; closing-script text экранируется | Fixture/SSR tests, включая независимый review; не Studio publication |
| Настоящая CRM из браузера | Loopback форма отправляет собственный dev alias; первый accepted ответ намеренно теряется; retry сохраняет operation/conversion; новый request нейтрален; hash-only SQL row проверена; собственные contact/rows/rate hits точно удалены; analytics requests = 0 | Реальные development Brevo и PostgreSQL; без Preview CRM-запросов |
| Настоящий browser → PostHog | SDK отправил 6 запросов с 2xx в EU development project; четыре разрешённых типа событий; одна demo conversion; comparison → CTA → form → accepted; no-consent/denied без запросов; withdrawal очищает storage, reload остаётся denied | Реальный provider transport, **accepted — synthetic lead adapter**, CRM POST перехвачен |
| Проверка PostHog UI | Read-only provider SQL подтвердил четыре типа событий, одну demo operation и ordered journey `1 / 1`; отдельно synthetic SQL проверил unique visitors/operations и границу 7 дней | Реальный UI/query результат; dashboard/insight не сохранялся, uplift не измерялся |
| Collector last-valid и отказ источника | Сохранились действительный ноль и исходные даты; другой продукт обновился при partial failure | Production collector/read model на реальном изолированном PostgreSQL, source adapters fixtures |
| Lock, mapping и crash recovery | Реальный session lock остановил competing writer до sources/writes/invalidation; mapping recheck пропустил запись; abrupt child exit сохранил первую transaction; новый run восстановил вторую и получил освобождённый lock | Реальный PostgreSQL/session/process; CMS/source/cache adapters fixtures, не внешняя авария |
| AI-review, ранее принятый DP-07 | Разрешённая dev API-публикация изменила score 100 → 69; signed local webhook показал изменение за 8.920 s; исходные поля восстановлены | Наследуемое live evidence отдельного run; не Studio UI и не automatic delivery |

| Combined CMS → CRM, no-consent | Опубликованная CMS comparison → CTA → форма → настоящий Brevo accepted; потерянный ответ/retry/duplicate; hash-only SQL; analytics 0; точная очистка | Реальные CMS/Brevo/Neon на loopback; собственный dev alias |
| Combined CMS → CRM → PostHog, granted | Настоящий accepted, 6 успешных ingestion responses, 4 event types; conversionId согласован с принятой операцией; withdrawal/reload; точная очистка | Реальные development CMS/CRM/SQL/PostHog; отдельный dashboard readback этой операции не выполнялся |
| Studio AI-review → automatic webhook → HTML | Actual Studio UI publish, score 69 → 100 за 20.219 s от начала watcher до publish; автоматическая доставка HTTP200, без deploy/manual invalidation | Synthetic owned review на настоящем development CMS; не утверждение возможностей вендора. Review удалён с полной проверкой тела/CAS |
| Изолированный CMS lifecycle | Draft public404, authenticated preview200/noindex, forged session404, disable очищает cookies; publish7.091 s, update3.455 s, unpublish3.976 s, rename308 за4.151 s; связанные category links обновляются | Реальные development CMS/защищённый Preview, API sessions с тем же publication validator; automatic webhook only. Все собственные документы удалены |

В schema comparison/methodology используется `WebPage`: текущая публичная проекция не содержит автора. Авторство, даты изменения, цены и ratings не выдуманы. Методологический seed остаётся synthetic placeholder, а не финальной редактурой.

## Ограничения и следующий порядок

1. LM-08 fake tests/browser выполнены локально и на development Preview с перехватами. Удалённый CI не запускался; стандартный development browser harness запрещает CI context. Следующая задача — QA-01: безопасный fixture CI path без live credentials, затем независимое итоговое review LM-08/CW-07/FP-05. Локальный pass не переименован в CI pass.
2. Временный Automation Bypass явно разрешён владельцем только для приёмки. После проверок секрет отозван, другой bypass сохранён, header Sanity удалён, временный credentialed CORS origin удалён; localhost:3333 сохранён. Development webhook выключен после удаления доступа. Подпись и минимальная пятиключевая projection настроены. Постоянный защищённый delivery target надо выбрать до регулярной редакторской работы; текущие проверки подтверждают сценарий во время приёмки, а не непрерывную доставку после cleanup.
3. Исходная авторитетная CLI-проверка webhook показала старый `pkg-compass-chi.vercel.app`, disabled, без signing secret/projection. Ранее записанный `ai-chat-test-lake` был устаревшим UI-наблюдением и не используется как доказательство. Настройка исправлена по официальному [Webhooks API](https://www.sanity.io/docs/http-reference/webhooks): projection находится внутри `rule`, не в legacy top-level поле.
4. Первые неуспешные попытки сохранены отдельно. CMS matrix сначала ошибочно валидировал published документ через raw perspective, учитывая собственный draft как duplicate; повтор с published perspective прошёл, предыдущие данные очищены. Первоначальная cleanup проверка AI-review остановилась из-за добавленного Studio `_system.base{id,rev}`; read-only сверка доказала точное совпадение всех редакторских полей, после чего выполнен CAS cleanup. Ручная подписанная invalidation применена только к очистке оставшегося cache двух тестовых Preview, не к acceptance evidence.
5. Production расписание, удаление/restore, полный контент пяти CMS/трёх сравнений, дизайн и release gates остаются последующими задачами. Browser real-CRM smoke выполнялся на loopback для точной принадлежности/очистки synthetic rate hits; Preview form smoke использовал intercepted responses.

Автоматическая проверка безопасности отклонила share-link access и первую попытку cleanup без достаточного ownership proof. Share link не создан; доступ выполнен через обычный owner OIDC. Cleanup выполнен только после дополнительного read-only доказательства полного тела и системных метаданных. Неотменённых временных расширений доступа нет.

## Пересчёт остатка

**Уже потраченное активное время: `not_measured`.** Worklog содержит даты событий, но не учёт времени исполнения; календарный промежуток включает ночную паузу и ограничения доступа/лимитов. Его нельзя объявить рабочими часами. Поэтому подтвердить или опровергнуть исходную гипотезу **66–106 часов** из [архитектуры](../../05-architecture.md) по фактическим затратам сейчас невозможно.

Ниже — новая планировочная оценка **только оставшейся активной работы**, для одного React/TS-разработчика с текущими заготовками, пятью CMS и тремя сравнениями. Это диапазоны, не уже потраченное время и не обещание срока. Ожидание доступа, решения владельца, сборок/лимитов и обучение сверх знакомого стека в часы не включены.

| Остаток | Задачи | Оценка, часы |
| --- | --- | ---: |
| Закрыть оставшиеся prototype gates и выявленные исправления | LM-08, CW-07, FP-05 | 4–10 |
| Визуальная система и макеты | CW-16 | 8–12 |
| Довести публичный UI, поиск/фильтры, состояния, методологию и SEO | CW-08–CW-12, CW-14–CW-15; только доведение после прототипа | 10–18 |
| Проверить и отредактировать production контент пяти CMS и трёх сравнений | CW-13 | 10–18 |
| Расписание/maintenance/TTL и сохранённый analytics report | DP-08, LM-09, оставшаяся часть LM-07; без повторного учёта реализованной формы/collector | 6–12 |
| CI, общая приёмка, доступность/performance, deletion/restore rehearsal | QA-01–QA-04; проверки отдельно от реализации maintenance | 10–18 |
| Production targets/release gate, разрешённый выпуск и публичный кейс | QA-05–QA-06 | 4–8 |
| **Остаток** | Включая незакрытый M1, затем M2/M3 и выпуск | **52–96** |

M2 в этой оценке — доведение существующих функций, а не их повторная реализация. Задачи со статусом `review` не считаются автоматически завершёнными: если их приёмка обнаружит изменение контракта или существенный дефект, диапазон нужно пересчитать. При сокращении scope остаются пять CMS/три сравнения и более простая визуальная отделка; CRM, consent, SEO, защита данных и обязательная приёмка не исключаются.
