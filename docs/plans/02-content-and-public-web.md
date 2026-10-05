# План реализации: CMS, редакционный контент и публичный web

Дата: 5 октября 2026. Статус: план работ, не отчёт о выполнении. Этот план раскладывает реализацию Sanity, редакционного наполнения, публичных страниц, SEO и AI-readiness UI на задачи. Нормативные поля, состояния, URL и критерии остаются в спецификациях [02](../02-product-and-scope.md), [03](../03-user-flows-and-pages.md), [04](../04-content-model.md), [05](../05-architecture.md), [07](../07-ai-readiness.md), [08](../08-localization-and-seo.md), [11](../11-quality-plan.md) [ADR 0013](../decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](../decisions/0014-learning-project-simplifications.md). Здесь они не переопределяются.

Объём v1 — одна CMS-категория, 5–8 продуктов, 3–5 редакционных сравнений и только английский язык. Основной публичный путь: главная → категория → CMS → опубликованное сравнение → первоисточник или заявка. Все публичные чтения используют опубликованный контент и единое серверное решение о готовности. Предложенные ниже пути кода иллюстративны и могут быть уточнены в реализации.

## Этапы и внешние зависимости

**Сквозной прототип.** Проверить на development-окружении Sanity/Next.js и представительном наборе из 3–5 CMS и одной пары: редакционная запись → публичная страница → защищённый preview → публикация/webhook/кеш; вместе с data pipeline проверить импорт, fallback и отображение AI-review. Сценарии формы → CRM, согласия и аналитики остаются в прототипе и закрываются LM-01–LM-08; они не переносятся в доведение v1 и не дублируются задачами CW. Дальше по результатам прототипа уточняются только технические решения в рамках принятого scope.

**Завершение v1.** Расширить проверенную вертикаль до всех шаблонов и публичных состояний, довести production-контент до 5–8 продуктов и 3–5 сравнений, пройти SEO, доступность, performance и release-приёмку.

Внешние зависимости показаны ссылками на [план основания](01-foundation.md), [план данных](03-data-and-collector.md), [план lead-потока](04-leads-consent-and-measurement.md) и [план качества](05-quality-operations-and-release.md). FP-04 предоставляет development-окружение; production targets подготавливаются на шаге 1 QA-05 до release gate. CW не дублирует их реализацию.

## Задачи

### CW-01 — Зафиксировать границы public read и readiness

**Этап:** сквозной прототип. **Зависимости:** FP-01, FP-02, FP-03.

Для FP-03 требуется только первый проход (migration runner, connection factories и baseline roles); финальные grants проверяются после таблиц DP/LM. Readiness resolver использует общие ports/adapters FP-02, не создаёт второй набор интерфейсов. Реальные Sanity/PostgreSQL adapters и snapshots подключаются в CW-07.

1. Определить границу server-only чтения через общие repository/adapters ports FP-02 и allowlist полей; не предусматривать возврат draft-полей, редакторских заметок, секретов или private lead state.
2. Описать единый readiness resolver для route lookup, связанных ссылок и будущей проекции sitemap по модели 04/08; на первом шаге дать ему типизированные входы и фикстуры для опубликованной сущности, draft, неполного content-документа, отсутствующей locale и незаданного slug.
3. Зафиксировать через фикстуры, что ошибка источника метрик сохраняет редакционную страницу и не превращается в ноль; конкретные data states подключить по 06/07 и `DP-*` в CW-07.
4. Развести два результата: неготовый или неизвестный публичный контент даёт 404, а недоступность CMS без валидного cache fallback даёт 503; до CW-07 это проверить на doubles/fixtures.

**Артефакты:** readiness resolver и фикстуры для published, draft, неполной готовности и отказа CMS (предложенные пути: `src/domain/publication-readiness.ts`, `tests/fixtures/content/`). Реальные адаптеры не входят в эту задачу.

**DoD:** интерфейс выражает различие между непубличной/неполной сущностью и отказом источника; фикстуры подтверждают 404 для неготового контента и 503 для отказа CMS без валидного cache fallback; маршрут, навигация и sitemap могут использовать один resolver. Связь с реальными CMS/DB и проверка draft boundary проходят в CW-07. **Проверки:** Q03, Q05, Q06.

### CW-02 — Реализовать схемы Studio, проверки публикации и seed input

**Этап:** сквозной прототип. **Зависимости:** CW-01, [DP-01](03-data-and-collector.md).

DP-01 предоставляет общий runtime mappingKey-контракт; seed CLI и запись документов выполняет DP-04 после готовности схем.

1. Описать Sanity schemas для сущностей и локализованных документов из 04, включая ограниченные home sections, sources/sourceKeys, references, SEO-поля, redirects и aiReview. Не вводить дополнительные content types, произвольный builder или новые доменные поля без изменения исходного контракта.
2. Добавить Studio-валидацию для быстрой обратной связи и проверку обязательных условий в контролируемом Studio publish action. Прямая Sanity API публикация может обойти Studio action; такие документы должны быть отсеяны public readiness guard и не получать публичный URL.
3. Развести публикацию common entity и locale content в принятом порядке; проверять актуальную revision при publish и не объявлять URL публичным до готовности обоих документов.
4. Подготовить схемы/фикстуры входных документов для seed-задачи DP-04, указав opaque IDs, references и поля, которые seed обязан сохранить. В Studio mapping action вычислять общий mappingKey через DP-01. Не дублировать в CW код или запуск seed; изменение принадлежности SDK/репозитория остаётся конфликтом для ручного решения по data-плану.
5. Отобразить результат проверки в Studio publish action: блокирующая ошибка, исправимые замечания, подтверждённая публикация или диагностируемый отказ.

**Артефакты:** схемы Studio, проверки готовности, Studio publish action и seed input fixtures (предложенные пути: `studio/schemas/`, `studio/actions/`, `tests/fixtures/content-seed/`). Реализация и запуск seed принадлежат DP-04.

**DoD:** черновик сохраняется неполным; Studio publish action блокирует нарушение обязательных условий; API-published неполный документ исключён public readiness guard; seed input соответствует модели и integration acceptance DP-04 подтверждает, что повтор seed не затирает редакторскую правку и не создаёт дубль. **Проверки:** Q02, Q05, Q07.

### CW-03 — Подготовить прототипный редакционный набор

**Этап:** сквозной прототип. **Зависимости:** CW-02, [DP-04](03-data-and-collector.md), FP-04.

DP-04 владеет seed CLI; FP-04 требуется для live development загрузки. Контрактные фикстуры можно готовить до готовности live target.

1. Выбрать 3–5 CMS только из утверждённого стартового набора по [ADR 0005](../decisions/0005-starting-cms-set.md); не добавлять продукты или категории сверх него.
2. Подготовить редакционный входной набор/фикстуры, покрывающие основной SDK, допустимое отсутствие SDK, несколько hosting/API значений, published/draft, опубликованный и неполный AI-review и один разрешённый comparison pair. Входы mapping проходят DP-01; загрузку и идемпотентность проверяет seed DP-04.
3. Для прототипных страниц использовать проверяемые источники с датами; явно обозначить временные/синтетические значения как тестовые фикстуры, чтобы они не попали в production публикацию.
4. Выпустить один содержательный comparison для проверки связей и таблицы. Это прототипный материал, а не замена финальному редакционному комплекту.

**Артефакты:** редакционные входные данные/фикстуры для development seed и список записей с источниками и статусом готовности.

**DoD:** DP-04 загружает входные данные идемпотентно; scoped package lookup связан ровно с продуктом; выбранная пара однозначна по стабильным IDs; в прототипе проверяются complete/incomplete/not-applicable data states без изготовления фактов. **Проверки:** Q02, Q07, Q08, Q11.

### CW-04 — Собрать и защитить preview workflow

**Этап:** сквозной прототип. **Зависимости:** CW-01, CW-02, FP-04.

Sanity Presentation/session механизм проверяется на development targets из FP-04.

1. Настроить вход в preview через проверенную редакторскую сессию, разрешая только относительный внутренний путь; проверять пользователя до чтения draft.
2. Выполнять draft query только на сервере отдельным draft-read credential. Cookie — HttpOnly, Secure, SameSite, TTL 1 час; не передавать token в клиент, URL или общий logger.
3. Для preview применять `no-store`, `noindex,nofollow` и пометку режима. Использовать общий resolver с preview perspective, допуская неполные поля в объяснимом редакторском представлении.
4. Завершение preview очищает сессию и возвращает посетителя к опубликованной версии. Проверить два независимых browser sessions после прогрева public cache.

**Артефакты:** вход/выход preview, защищённый server read path и smoke-сценарии доступа.

**DoD:** guest и неверная/просроченная сессия получают 401/403 без draft текста; авторизованный редактор видит draft; draft отсутствует в обычном HTML, API, metadata/OG, sitemap и общем кеше; preview path не допускает open redirect. **Проверки:** Q05.

### CW-05 — Подключить publication webhook и управляемый кеш

**Этап:** сквозной прототип. **Зависимости:** CW-04.

Handler разрабатывается по контракту 05 и проверяется на development target FP-04, уже доступном через CW-04. Его вызывает downstream read/cache integration DP-06; DP-06 не является prerequisite этой задачи.

1. Подключить raw-body signature verification и лимит размера webhook; проверять schema, environment, dataset и тип документа до вычисления серверных cache tags.
2. Инвалидировать зависимые страницы: content/entity, category, связанные comparisons, home, metadata/navigation и sitemap; изменение aiReview также инвалидирует публичные карточки/сравнения.
3. Обрабатывать повтор webhook идемпотентно и никогда не принимать переданные из payload cache tags/redirect targets как доверенные.
4. Зафиксировать выбранный для pinned Next.js механизм и проверить резервный TTL 3600 секунд. Успешная публикация должна быть видна повторным запросом не позднее 60 секунд; снятие публикации и rename требуют немедленного истечения затронутого кеша. Это критерии проверки прототипа, не SLA.
5. Отдельная импортная invalidation принимает только настроенный secret/environment и allowlist product IDs; временный отказ отражается в отчёте collector, TTL ограничивает stale окно. Read cache hooks согласовать с DP-06.

**Артефакты:** server-only webhook handlers, tag dependency map и запись реальных latency для publish, unpublish, rename и повторного события.

**DoD:** неверная подпись отклонена; корректное повторное событие безопасно; публикация, снятие и rename меняют правильные связанные страницы; задержка повторного HTTP запроса после успешного события укладывается в 60 секунд; резервный TTL и import invalidation проверены. **Проверки:** Q05, Q06.

### CW-06 — Реализовать URL identity, pair routing и rename flow

**Этап:** прототипный контракт, затем v1. **Зависимости:** CW-02.

Route logic опирается на общие environment/adapters из FP-02; production origin задаётся при релизной подготовке QA-05. URL правила берутся только из 08.

1. Реализовать единые построители/разборщики маршрутов для всех публичных путей; использовать их в ссылках, canonical, Open Graph, redirects и sitemap. Адреса отдельных страниц не собирать вручную в компонентах. Для прототипа использовать test origin; production origin поступает из конфигурации QA-05.
2. Разрешать CMS по стабильному ID/актуальному `routeSlug`; rename displayName/packageName не меняет путь. При смене routeSlug атомарно сохранить старый путь в redirect registry до выпуска нового пути.
3. Сравнения адресовать парой различных стабильных IDs в заданном порядке ID. `displayOrder` влияет только на визуальные колонки. Reverse pair ведёт одним 308 на каноническую пару; произвольная/неразрешённая пара — 404.
4. Запретить повторное назначение slug с активным alias, redirect cycles/chains и внешние target paths. Пересчитать links и paths всех существующих comparisons при rename; если цель снята с публикации, alias заканчивается 404.
5. Для `/`, отсутствующего завершающего slash и query следовать принятому 308/normalization контракту 08; неизвестный locale не подменять английской страницей.

**Артефакты:** route resolver/builders, redirect registry mutation и матрица URL-тестов (предложенный путь: `src/domain/routes.ts`).

**DoD:** rename CMS ведёт старый адрес напрямую на актуальную карточку и актуальные затронутые пары; B/A → A/B одним 308; отображение колонок не меняет URL; query нормализован повторяемо; отсутствующий locale/draft даёт 404 без canonical. **Проверки:** Q03, Q04.

### CW-07 — Закрыть прототипную публичную вертикаль

**Этап:** сквозной прототип. **Зависимости:** CW-03, CW-04, CW-05, CW-06, FP-04, [DP-05/DP-06/DP-07](03-data-and-collector.md), [LM-08](04-leads-consent-and-measurement.md).

LM-08 закрывает независимый прототип формы/consent/measurement на fake и dev targets; combined CMS/data/lead путь затем проверяется здесь и в FP-05. DP-06 зависит от CW-05, обратной зависимости нет. Этапный gate FP-05 принимает результаты потоков и не является зависимостью CW-07.

1. Запустить metrics collector DP-05 и поднять страницы на реальном development контенте: home, категория, карточка и одна пара comparison; открыть methodology stub только с опубликованным утверждённым текстом; AI-блок читает опубликованный review по DP-07.
2. В SSR отдать основной текст, title, description, canonical, robots, `lang`, OG и JSON-LD; UI не ждёт client-side SDK или consent для чтения контента.
3. Проверить реальную Sanity публикацию без deploy, preview-denied path, webhook update/remove/rename и DP-06 metrics read/fallback path.
4. Пройти prototype acceptance вместе с владельцами DP-05/06/07 и LM-08: lead vertical отдельно проверяет LM-03–LM-07 на fake/dev targets, после чего combined smoke подтверждает путь форма → CRM и согласие → событие через публичную CMS страницу. Эти сценарии обязательны для закрытия прототипа и не становятся задачами после завершения content/web.

**Артефакты:** работающая dev-вертикаль и очищенные smoke artifacts с environment/version/сценарием; никаких draft/secret/PII в артефактах.

**DoD:** 3–5 CMS и одна пара проходят CMS → HTML → preview → publish/webhook/cache; DP-05/06 обеспечивает metrics collect/read/fallback, а DP-07 — публикация AI-review в Studio видна на сайте после webhook без отдельного запуска; LM-08 подтверждает независимый lead prototype, а FP-05 проверяет combined form/CRM/consent/measurement flow; реальные API/версии и доступы зафиксированы. **Проверки:** Q04–Q09, Q11, Q13–Q16.

### CW-08 — Собрать общий публичный каркас и главную

**Этап:** завершение v1. **Зависимости:** CW-07, CW-16, [LM-05](04-leads-consent-and-measurement.md), [LM-06](04-leads-consent-and-measurement.md).

Каркас реализует визуальную систему и макеты CW-16. Встраивание request form и Privacy settings использует готовые компоненты LM-05/LM-06; CW-08 не владеет обработчиком или состоянием consent.

1. Реализовать английские site header/footer, logo link, catalog/methodology/request navigation, breadcrumbs на вложенных страницах, footer links на privacy и Privacy settings.
2. Собрать home по разрешённым секциям из page builder: один hero первым, опубликованные категории/products/comparisons, teaser методологии; ссылки резолвятся через общие builders.
3. Добавить недоступные/empty/error/loading состояния для страниц с понятным переходом в каталог; технический сбой не представлять как 404.
4. Реализовать отдельные route shells `/en/request-shortlist/` и `/en/privacy/`: request page встраивает форму LM-05, Privacy settings из LM-06 доступен в footer; privacy page публикует согласованный owner contact и сведения из privacy spec. CW не добавляет обработчик формы, CRM, consent SDK, аналитику или новые privacy promises.

**Артефакты:** public shell, home sections renderer, request/privacy routes и английские состояния.

**DoD:** общий каркас доступен клавиатурой и на узком экране; home не ссылается на неопубликованные documents/функции; форма работает при любом analytics consent state через интеграцию lead-потока; privacy/contact соответствует утверждённому содержимому; нет language switcher или фиктивного поиска. **Проверки:** Q01, Q12, Q14, Q15, Q18.

### CW-09 — Реализовать категорию, поиск, фильтры и устойчивое состояние URL

**Этап:** завершение v1. **Зависимости:** CW-06, CW-08.

Рендер проверяется на общих fixtures FP-02; он не ждёт production content CW-13.

1. Вывести опубликованные и readiness-qualified английские продукты выбранной категории с предсказуемой сортировкой по displayName.
2. Сделать поиск по displayName и точному packageName; нормализовать пробелы/регистр, ограничить запрос 120 символами, не создавать повторную карточку для нескольких совпадений одного продукта.
3. Подключить только принятые `q`, повторяемые `hosting`, `api`; для фильтров соблюсти OR внутри значения одного ключа и AND между ключами. Добавить применить/reset, видимое активное состояние, empty state, count announcement и восстановление состояния через reload/Back.
4. Неизвестные значения безопасно нормализовать; не вводить общий поиск, сортировку по score или иные фильтры.

**Артефакты:** категория с фильтруемым серверным/public dataset и синхронизацией контролов с URL.

**DoD:** scoped package query возвращает одну CMS-карточку; два фильтра, reload, back/reset дают ожидаемые результаты; пустое значение фильтра не трактуется как доказанное отсутствие возможности; query не превращается в HTML без escaping. **Проверки:** Q01, Q03, Q18.

### CW-10 — Реализовать страницу CMS и видимые состояния данных

**Этап:** завершение v1. **Зависимости:** CW-06, CW-08, [DP-06](03-data-and-collector.md), [DP-07](03-data-and-collector.md).

Рендер проверяется на fixtures FP-02 до готовности production content CW-13; DP-06 и DP-07 подключают соответственно metrics read/fallback и AI states/evidence.

1. Вывести обязательные редакционные блоки продукта в порядке вопросов из 03: назначение, use cases, fit/not fit, ограничения, JS/TS integration, источники и опубликованные альтернативы/comparisons.
2. Метрики отображать с объектом наблюдения, периодом, датой и источником; не называть SDK downloads числом пользователей. Monorepo stars подписывать на уровне репозитория. При null/error/stale сохранить редакционный текст и объяснить состояние.
3. Для AI-review показать состояние каждого сигнала, scope/evidence/date и связь с methodology. Score показывать только для полного опубликованного review с совпадающим mapping; `mapping_changed` и пометку «старше 90 дней» показывать текстом.
4. Все references вести только на публично готовые документы; внешний первоисточник снабдить ясной подписью.

**Артефакты:** библиотечный шаблон и состояния metric/AI blocks, связанные с read model.

**DoD:** reviewer может проверить редакционные основания, дату и правильный объект метрики; error не отображается как ноль; `score=null`, incomplete, not_applicable, `mapping_changed` и stale представлены различно; нет битых/непубличных references. **Проверки:** Q02, Q08, Q11, Q18.

### CW-11 — Реализовать редакционное сравнение

**Этап:** завершение v1. **Зависимости:** CW-10.

Шаблон проверяется на comparison fixture до финального редакционного комплекта; итоговые 3–5 материалов готовятся в CW-13.

1. Вывести задачу/аудиторию, критерии и доказательные ячейки обеих CMS, условия выбора каждой стороны, ограничения, дату редакционного пересмотра, метрики/AI states и links на продукты/источники.
2. Учитывать `displayOrder` только при отображении; ключ пары и URL берутся из stable IDs. Не генерировать страницы произвольных пар.
3. Не ранжировать review разных версий AI-методологии; неполный score оставлять отсутствующим с объяснением, не подменять нулём/преимуществом конкурента.
4. Готовый comparison с `indexingRequested=false` обслуживать как 200/noindex и исключать из sitemap; неготовый публично отсутствует согласно readiness.

**Артефакты:** сравнение с семантически связанной доступной таблицей и условиями выбора.

**DoD:** минимум три содержательных критерия и самостоятельный verdict подтверждены редакторской проверкой; каждое проверяемое утверждение имеет источник; A/B и B/A приходят к одному материалу; мобильная таблица сохраняет заголовки и связь ячеек. **Проверки:** Q02, Q03, Q11, Q18.

### CW-12 — Выпустить AI-readiness методологию и UI

**Этап:** прототипный slice, окончание в v1. **Зависимости:** CW-07.

Review и расчёт балла поступают из DP-07; renderer использует prototype fixtures, а финальный текст готовится в CW-13.

1. Реализовать `/en/methodology/ai-readiness/` как опубликованную страницу с действующей версией, сигналами, формулой и округлением, примерами, датами, ограничениями и пояснением, что это редакционная проверка наличия agent support, не оценка качества/безопасности/эффективности CMS.
2. Методологический score example вычислять приложением из значений активной версии; не давать редактору вводить вычисленный итог и не менять сохранённые снимки при редактировании описания.
3. Связать методологию с product/comparison AI states и evidence. Методология объясняет срок свежести 90 дней и состояние `mapping_changed`.
4. Сохранить error/unknown/official-vs-community, applicability и stale как разные объяснимые состояния; автоматический обнаружитель сигналов, MCP запуск, Context7, skills и публичные AI feed endpoints не добавлять.

**Артефакты:** methodology page, вычисляемые примеры и общий набор UI blocks для evidence/states.

**DoD:** примеры 100/69/81/38/null соответствуют 07; отсутствующий/ошибочный сигнал не получает score; community MCP не называется official; у каждой production CMS есть опубликованный review, но валидный неизвестный/error/not_applicable допустим. **Проверки:** Q11, Q04.

### CW-13 — Подготовить production editorial content

**Этап:** завершение v1. **Зависимости:** CW-09, CW-10, CW-11, CW-12, [DP-03/DP-07](03-data-and-collector.md).

MappingKey и seed input уже подтверждены DP-01 и DP-04. DP-03/DP-07 дают published mapping и review evidence для проверки фактического контента. Шаблоны страниц CW-08–CW-12 используют fixtures и не ждут наполнения CW-13.

1. Расширить набор до 5–8 продуктов утверждённой CMS-категории и 3–5 сравнений; дополнить home/category/methodology/privacy published documents. Не расширять каталог/языки и не превращать SEO в массовое programmatic generation.
2. Для каждого продукта подготовить семь принятых критерийных блоков, summary, use cases, fit/not-fit, limitations, integration notes, sources, reviewedAt, SEO text и references; если сопоставимого SDK нет — заполнить предусмотренную причину.
3. Для каждого сравнения выбрать реальную задачу и аудиторию; подготовить минимум три различимых, подтверждённых источниками критерия, условия выбора каждой CMS, ограничения и собственный вывод. Для пар с Sanity заполнить `disclosure`. Не индексировать тонкую или неготовую пару.
4. Провести редакторский review актуальности первоисточников и объяснения неопределённости. Даты импорта/metrics не подставлять вместо reviewedAt.
5. Запустить content readiness report по опубликованному dataset: broken refs, непубличные ссылки, пустые обязательные блоки, дубли slugs/pairs, future reviewedAt, недостаточные сравнения.

**Артефакты:** опубликованный редакционный набор, таблица источников/review status и readiness report без неподтверждённых factual claims.

**DoD:** в production dataset имеется 5–8 готовых карточек и 3–5 готовых сравнений; все facts имеют применимые источники/даты; все публичные references разрешаются; AI-unknown не маскируется придуманным числом; каждый indexed comparison содержит редакционное основание. **Проверки:** Q02, Q03, Q07, Q08, Q11.

### CW-14 — Завершить SEO, metadata, structured data и технические страницы

**Этап:** завершение v1. **Зависимости:** CW-06, CW-08, CW-09, CW-10, CW-11, CW-12, CW-13.

Production origin и release target подготавливаются шагом 1 QA-05 до её release gate; CW-14 не зависит от завершения QA-05.

1. Применить матрицу статусов из 08 для indexable/noindex/404/308/503, canonical, robots и sitemap к каждому route и query state; readiness не дублировать отдельной логикой.
2. Реализовать production robots.txt и sitemap только из готовых HTTPS canonical 200. Исключить alias, query, draft, preview host, приватные API, privacy и noindex comparisons. Сохранить корректный lastmod; сбой источника не порождает успешную пустую карту.
3. Отдать SSR title/description, canonical, `lang=en`, robots и согласованные OG metadata на всех HTML routes; origin никогда не брать из входящего Host/preview deployment.
4. Добавить лишь подходящие visible-content structured data типы по 08. Корректно экранировать CMS text в JSON-LD; не изобретать цены, рейтинги, SearchAction или product facts из SDK metrics.
5. Проверить запросы `/`, missing slash, старых slug, обратной пары, tracking и filter query, неактивной locale, guest/auth preview, снятого с публикации продукта/пары, отказа CMS и sitemap fallback.

**Артефакты:** metadata builders, robots/sitemap handlers, per-route SEO matrix и HTTP/HTML assertions.

**DoD:** для каждой страницы фактический HTTP status, canonical, robots и sitemap membership совпадают с 08; HTML содержит полезный H1/content; search/filter noindex сохраняет нормализованный canonical state; tracking не попадает в canonical; JSON-LD разбирается и не может закрыть script tag через CMS text. **Проверки:** Q03, Q04, Q05, Q06, Q19.

### CW-15 — Подготовить public web к общей приёмке

**Этап:** завершение v1. **Зависимости:** CW-14.

Development verification использует FP-04; production target и origin подготавливаются шагом 1 QA-05 до release gate. Data/lead evidence предоставляет соответствующий поток; web handoff используют QA-03/QA-05.

1. Зафиксировать web маршруты и состояния, которые войдут в общий critical path: nav → category filters → product → comparison → request → privacy/consent controls.
2. Подготовить матрицу HTTP/HTML assertions по готовности, canonical/robots, query/rename/pair, preview boundary, cache invalidation, sitemap и SEO. Сверить маршруты с одной readiness проекцией.
3. Передать QA-02 воспроизводимый путь и negative cases для общей сквозной приёмки; QA-03 получает страницу/состояния/viewport для своей доступности и performance проверки; QA-05 получает production-origin, sitemap и release-smoke evidence.
4. Привязать web artifacts к commit/deployment/environment и очистить secrets/PII. CW формирует и передаёт evidence, а полные accessibility/performance/release gates закрываются владельцами QA задач.

**Артефакты:** HTTP/HTML evidence, route/state matrix и пакет handoff для QA-02/QA-03/QA-05.

**DoD:** HTTP/HTML матрица public web проходит ожидаемые статусы и metadata по 08; preview и draft boundary evidence воспроизводится; SEO/route пакет передан QA-02/QA-05, а маршруты и viewport для Q18/Q19 — QA-03. Q07–Q17 остаются у data/lead владельцев. CW не объявляет общую Q01–Q19 приёмку закрытой. **Проверки:** web evidence по Q01–Q06, handoff для Q18–Q19.

### CW-16 — Визуальная система и макеты ключевых экранов

**Этап:** параллельно сквозному прототипу, до CW-08. **Зависимости:** нет; удобно начать после FP-01, чтобы токены сразу легли в Tailwind-конфиг. Направление — [ADR 0011](../decisions/0011-interface-direction.md), сценарии — 03.

1. Определить токены: цвета (светлая основа, нейтральные, один акцент, статусные цвета с текстом), типографика, сетка, отступы, радиусы; проверить контраст AA.
2. Нарисовать ключевые экраны desktop и mobile: главная, карточка продукта, сравнение. Отдельно — каталог с фильтрами, форма заявки, consent banner и состояния loading/empty/error/stale.
3. Описать базовые компоненты и их состояния: карточка в каталоге, блок метрики со спарклайном, AI-блок с сигналами и датой, таблица сравнения на мобильном.
4. Перенести токены в Tailwind-конфиг; макеты хранить как ссылку или экспорт в `docs/design/`, без исходников с личными данными.

**Артефакты:** токены в коде, макеты ключевых экранов, короткое описание компонентов (`docs/design/README.md`).

**DoD:** экраны покрывают сценарии 03 и состояния из 06/07/09; контраст и размеры touch-целей проверены; CW-08–CW-12 строятся по этим макетам без повторного выбора направления. Оценка 8–12 часов (05 §7). **Проверки:** вклад в Q18, Q19.

## Карта покрытия качества

| Qxx | Задачи плана | Владелец проверки / граница |
| --- | --- | --- |
| Q01 | CW-08, CW-09, CW-15 | Public category, query, reset/back, responsive UI |
| Q02 | CW-02, CW-03, CW-10, CW-11, CW-13 | CMS references, контент и editorial review |
| Q03 | CW-01, CW-06, CW-09, CW-11, CW-13, CW-14 | Routes, rename/pair, query, locale/readiness |
| Q04 | CW-06, CW-07, CW-12, CW-14 | HTML metadata, schema, sitemap |
| Q05 | CW-01, CW-02, CW-04, CW-05, CW-07, CW-14 | Draft boundary, preview и отсутствие утечки |
| Q06 | CW-01, CW-05–CW-07, CW-14 | Publish/remove/rename, signature/repeat/cache latency |
| Q07 | CW-02, CW-03, CW-13 | CW задаёт seed input/fixtures и проверяет editorial preservation; seed execution проверяет DP-04 |
| Q08 | CW-03, CW-10, CW-13 | MappingKey/metrics evidence — DP-01/DP-03/DP-06; UI корректно называет объект метрики |
| Q09–Q10 | CW-07, CW-15 | Fallback метрик и восстановление принадлежат DP-06/DP-08; CW передаёт web evidence отображения |
| Q11 | CW-03, CW-10–CW-13 | Формула и чтение review — DP-01/DP-07; методология и UI — CW |
| Q12–Q16 | CW-07, CW-08, CW-15 | LM-01–LM-08 владеют формой, CRM, consent и measurement; LM-08 — независимый прототип, combined evidence идёт в FP-05 и QA-02 |
| Q17 | CW-15 | LM-02–LM-04/LM-09 владеют private state, TTL/delete/restore и ролями; QA-04 принимает restore evidence |
| Q18 | CW-16, CW-08–CW-11, CW-15 | CW готовит дизайн, public path/states; QA-03 владеет доступностью |
| Q19 | CW-14, CW-15 | CW передаёт страницы и origin matrix; QA-03 владеет Lighthouse, QA-05 — release smoke |

## Риски и точки проверки

- Sanity perspective, Presentation credential и draft permissions должны быть проверены на реальном development target FP-04 в CW-04. При отсутствии hosted защиты preview блокируется проверкой приложения до чтения draft; один draftMode cookie доступ не подтверждает.
- Конкретный Next.js cache API и webhook invalidation определяются после фиксации версии в foundation. До успешного smoke ≤60s — это открытый прототипный технический риск, не подтверждённый SLA.
- Readiness неверно работает, если маршрут, ссылки и sitemap вычисляют его по-разному. CW-01/CW-14 требуют общей проекции и матричной HTTP проверки, включая direct API publish.
- Slug rename затрагивает связанные comparison URLs и sitemap; реестр redirect должен быть обновлён до смены live slug, без цепочек и повторного присвоения alias.
- Редакционная полнота является заметной частью нагрузки: 5–8 доказательных страниц и 3–5 сравнения нельзя заменить валидной схемой или autogenerated таблицей. При ограничении времени ADR 0013 допускает минимальный набор 5 CMS/3 сравнения, но не исключение источников, собственного вывода, SEO, формы или consent/measurement.
- Текущие лимиты аккаунтов и разделение окружений проверяются в FP-04 для development и QA-05 для production; этот план не предполагает наличие настроенных credentials, пройденных проверок или закупленного домена.
