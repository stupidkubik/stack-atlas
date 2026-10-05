# PkgCompass: контентная модель и публикация

Дата: 5 октября 2026. Статус: рабочий контракт схем и редакционного процесса. Структурированная модель, document-level локализация, ограниченные секции главной и правила публикации приняты в [ADR 0009](decisions/0009-structured-content-model.md). Актуальные операционные границы — [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](decisions/0014-learning-project-simplifications.md); редакционные критерии — ADR 0006. Схемы реализуются и проверяются прототипом.

Модель обслуживает CMS-каталог, английское ядро и будущие категории/переводы. `product` — CMS-продукт, а не npm-пакет. По ADR 0013 и ADR 0014 Sanity хранит редакционный контент, mapping и aiReview, PostgreSQL — текущие метрики и заявки без email; импорт не редактирует тексты, slug и редакционные references. Технический формат Sanity `_id`/`_ref` маппится на стабильные доменные ID: в примерах `id` — доменный ID, не имя пакета и не slug.

## 1. Общие правила

- Все ID стабильны и не зависят от локали, названия, slug, внешнего аккаунта или версии пакета. Используем opaque ID с префиксом сущности; значения создаются один раз в seed. Sanity published _id = domain id, _ref = published _id; draft имеет стандартный drafts.<id>. ID локализованного контента = content.<type>.<entityId>.<locale>, page = page.<pageKey>.<locale>; aiReview = ai_review.<productId>.
- `routeSlug` — редакционный lowercase slug, рабочий формат `[a-z0-9]+(?:-[a-z0-9]+)*`; уникален в пределах типа маршрута. Для сравнения запрещён разделитель `-vs-` внутри slug продукта, чтобы маршрут разбирался однозначно.
- `packageName` хранится точно, включая `@scope/name`; нормализация для поиска не меняет исходное имя. Переименование пакета не меняет ID продукта и URL.
- Времена — ISO 8601 UTC; период метрики хранится явно. Локаль контента v1 — `en`. Пустое значение, ноль и неизвестность различаются.
- Внешние URLs — проверяемые HTTP(S); ссылки на ресурсы, доказательства и редакционные источники имеют понятную подпись. В публичном dataset нет секретов, персональных данных и приватных редакционных заметок.
- Массивы references не содержат повторов. Ссылки не ведут на удалённые документы; снятие публикации проверяется на входящие публичные references.

## 2. Сущности и поля

Знак `*` означает обязательность для готовой публикации, если не оговорено иначе. Черновик может быть неполным.

| Сущность | Поля | Владелец и инварианты |
| --- | --- | --- |
| `product` | `id*`, `displayName*`, `routeSlug*`, `categoryIds*`, `officialWebsiteUrl*`, `officialDocsUrl*`, `hostingModels[]`, `apiStyles[]`, `packageIds[]`, `repositoryIds[]`, `primaryPackageId?`, `primaryRepositoryId?` | Редактор; primary reference входит в соответствующий массив; отсутствие основного пакета допустимо с причиной в контенте |
| `package` | `id*`, `productId*`, `packageName*`, `role*` (`primary_js_sdk` / `additional`), `officialSourceUrl*` | Редактор подтверждает принадлежность; npm-имя уникально, основной SDK продукта не выбирается автоматически по downloads |
| `repository` | `id*`, `productId*`, `owner*`, `name*`, `scope*` (`product` / `package`), `packageId?`, `role*` (`primary` / `additional`), `officialSourceUrl*` | Редактор; `owner/name` — актуальная идентичность источника, `id` не меняется после rename; scope=package требует packageId |
| `category` | `id*`, `routeSlug*`, `displayOrder` | Редактор; одна стартовая CMS-категория; будущая категория не меняет ID продуктов |
| `productContent` | `id*`, `productId*`, `locale*`, `summary*`, `useCases*`, `fitsWhen*`, `avoidWhen*`, `limitations*`, `integrationNotes*`, `criteriaBlocks*`, `sources*`, `alternativeIds[]`, `noPackageReason?`, `reviewedAt*`, `seo*` | Редактор; уникальная пара productId+locale; текст на английском; noPackageReason обязателен без primaryPackageId |
| `categoryContent` | `id*`, `categoryId*`, `locale*`, `title*`, `intro*`, `seo*` | Редактор; уникальная пара categoryId+locale |
| `comparison` | `id*`, `productIds*`, `pairKey*`, `categoryId*`, `displayOrder*` | Редактор; ровно два разных продукта; pairKey вычисляется из sorted IDs; одна сущность на пару |
| `comparisonContent` | `id*`, `comparisonId*`, `locale*`, `title*`, `taskContext*`, `criteria*`, `choiceGuidance*`, `limitations*`, `verdict*`, `sources*`, `reviewedAt*`, `seo*`, `indexingRequested`, `disclosure?` | Редактор; уникальная пара comparisonId+locale; критерии/вывод ссылаются на ID продукта, а не номер колонки |
| `page` | `id*`, `pageKey*`, `locale*`, `title*`, `sections*`, `seo*` | Редактор; v1 pageKey=`home` / `aiMethodology` / `privacy`; уникальны pageKey+locale |
| `siteSettings` | `id*`, `siteName*`, `defaultLocale*`, `activeLocales*`, `navigation*`, `footerLinks*` | Редактор; в v1 defaultLocale=en, activeLocales=[en]; ссылки через route resolver, не произвольные строки маршрутов |
| `redirect` | `id*`, `sourcePath*`, `targetPath*`, `statusCode*` (=308), `createdAt*`, `reason*` | Контролируемое изменение slug; уникальный sourcePath, нет циклов и цепочек |
| `aiReview` | id=ai_review.<productId>, productId, mappingKey, methodologyVersion, signals, reviewedAt, reviewerLabel, overrideReason?, previousFinding? | Редактор; публичный read layer читает опубликованный review и считает балл по 07; в БД не копируется |
| `metrics_current` | productId, source, metric, идентичность источника, последняя попытка, последнее валидное значение с датой/периодом, ряд по дням | PostgreSQL, контракт 06; не Sanity document |

Read model вычисляется запросами. Отчёт run — CLI/CI artifact. Заявки и rate limits хранятся в PostgreSQL без email, их схема и права — [09](09-lead-form.md); никогда не Sanity documents.

`hostingModels`: `cloud`, `self_hosted`; `apiStyles`: `rest`, `graphql` — начальная таксономия фильтров. Несколько значений допустимы. Другое API описывается в тексте до введения нового фильтра; пустой массив означает, что классификация не выполнена. Эти признаки не должны заменять описание тарифных/развёртываемых вариантов продукта.

Один npm-пакет или репозиторий, связанный с несколькими продуктами, требует расширения relation-модели, а не дублирования сущности с разными ID. В стартовом seed выбираем однозначные связи; monorepo с несколькими SDK одной CMS поддерживается массивом package references и одним repository. Показатели общего репозитория не суммируются по SDK.

## 3. Структурированный редакционный контент

Рабочий формат prose — Portable Text с ограниченными marks и блоками: абзацы, H2/H3, списки, ссылки, кодовый фрагмент. H1 задаётся шаблоном страницы. Произвольный HTML, скрипты и вложенные page-builder секции не разрешены. Название продукта хранится в `product`, переведённое описание — в `productContent`.

`sources[]` содержит `{key, title, url, accessedAt}`. Проверяемое утверждение/критерий может ссылаться на `sourceKeys[]`; ключ должен существовать в том же документе. Дата `reviewedAt` — редакционный пересмотр, не время успешного импорта. `seo` содержит `{title, description}`; canonical и indexability вычисляются приложением, редактор не вводит произвольный canonical.

Критерий сравнения: `{key, label, description?, cells:[{productId, text, sourceKeys}], importanceNote?}`. В каждой строке ровно одна ячейка для каждого из двух продуктов. Отсутствие сведений обозначается в тексте; нельзя заменять его отрицанием. `choiceGuidance` содержит ровно две записи `{productId, conditions}`, по одной на каждый продукт. Порядок колонок не меняет смысл рекомендаций.

## 4. Ограниченный page builder

Builder нужен для главной, а не для произвольного конструирования карточек и сравнений. У сущностей каталога фиксированные шаблоны.

| Section type | Поля / ограничения |
| --- | --- |
| `hero` | heading, text, primaryLink (категория); ровно один, первый; secondaryLink? на request-shortlist; нет подписки/экспериментальных вариантов |
| `categoryLinks` | heading, categoryIds; только опубликованные категории |
| `featuredProducts` | heading, productIds; 1–8 уникальных опубликованных продуктов |
| `featuredComparisons` | heading, comparisonIds; 1–5 уникальных опубликованных сравнений |
| `methodologyTeaser` | heading, text, link на AI-методологию |
| `richText` | heading?, body с разрешёнными блоками; без вложенных секций |

Максимум восемь секций на главной; section key стабилен при перестановке. Для home секции задают композицию; aiMethodology и privacy используют richText sections (без требования hero). Методология использует prose и отдельный тип `aiScoreExample` с methodologyVersion и компонентами: балл вычисляет приложение, а не редактор. Методология обязана описывать активную формулу, неполные состояния и ограничения. Изменение текста методологии не переопределяет сохранённые снимки.

## 5. Локализация и идентичность

Принята document-level локализация редакционных материалов: отдельные `productContent`, `comparisonContent`, `categoryContent`, `page` с явной `locale`. Общие продукты, пакеты, repositories и снимки не дублируются. В v1 разрешена только `en`; добавление языка потребует явного включения и отдельной готовности каждого документа.

Это отличается от field-level локализации исходной концепции: отдельные документы позволяют независимо публиковать языки и не менять готовый английский материал при незавершённом переводе. Решение принято в [ADR 0009](decisions/0009-structured-content-model.md). Цена — больше references/запросов и документов; бюджет Sanity учитывает каждый locale-документ, его draft и общую сущность отдельно, а не один документ на всю карточку. Account setup по [05](05-architecture.md) сверяет количество этих документов/черновиков и фактические квоты на реальном seed; не считаем один продукт одним CMS-документом.

Готовность перевода определяется опубликованным документом соответствующей локали, прошедшим проверки, а не наличием пустого draft. Нельзя выдавать английский fallback под URL другой локали. `routeSlug` пока общий для продукта; перевод slug потребует нового SEO-контракта. Переименование displayName не меняет slug автоматически.

Для пары `prd_a`, `prd_b`: `productIds=sort([prd_a,prd_b])`, `pairKey=JSON.stringify(productIds)`; строковая сериализация исключает коллизии разделителей. Канонический URL использует slug в порядке productIds; displayOrder может быть обратным. Обратный URL получает 308. При изменении slug создаются redirects для карточки и существующих сравнений; они ведут сразу на актуальный путь. Нельзя повторно занять slug, для которого уже существует redirect.

## 6. Редакционные и импортируемые записи

Импорт пишет только текущие метрики в PostgreSQL; отчёт — локальный/CI artifact, не запись CMS/БД. Seed создаёт отсутствующие идентичности/связи как drafts, существующие пропускает; корректировки редактор делает в Studio. Повторная загрузка seed не откатывает правку владельца. Любое неожиданное изменение ownership/пакета поступает как конфликт, а не «исправление» редакционной связи.

Collector хранит для каждой метрики последнюю попытку и последнее валидное значение по 06; данные другого mapping не показываются как текущие.

AI-сигналы: `types`, `llmsTxt`, `mcp`; `state=present|absent|unknown|error|not_applicable`. Для types: `kind=bundled|external|none|null`. Состояние не заменяет свежесть. `completeness=complete|incomplete|not_applicable`; при двух последних score=null, фиксированный знаменатель 65 не меняется. Подробные доказательства, override и формула имеют единственный источник определения в 07.

Редактор публикует aiReview через Studio; публикация инвалидирует связанные страницы через webhook, read layer читает опубликованную версию. Незавершённый review остаётся черновиком. Причина исправления и previousFinding хранятся в самом review. В public dataset сохраняется только допустимый публичный состав аудита. Скрытие поля Studio не является защитой.

## 7. Draft, preview и публикационные проверки

Редакционные критерии приняты в [ADR 0006](decisions/0006-editorial-criteria.md): семь общих блоков карточки, контекст задачи и минимум три содержательных критерия сравнения, источники, даты и условия выбора. Общий рейтинг CMS не вводится. Эти требования дополняют структурные проверки ниже; схема использует criteriaBlocks: ровно семь уникальных ключей deployment, content_model, editorial_workflow, js_ts, localization_access, cost_limits, agent_support, каждый с Portable Text body и sourceKeys[]. Общие fit/avoid/summary поля дополняют эти блоки.

Draft хранит незавершённый материал; опубликованная ревизия продолжает обслуживать посетителей. Preview — аутентифицированное серверное чтение drafts без общего кеша и с noindex. Токен не выходит в клиентский bundle. Неавторизованный запрос не должен получить текст черновика. Preview объединяет draft+published через тот же resolver, но допускает неполные поля с пояснением; public guard эти документы не выдаёт. Проверку конкретных Sanity perspectives, draft access и механизма preview выполняем в техническом прототипе.

| Уровень | Что проверяем |
| --- | --- |
| Любая запись | Синтаксис ID/slug/URL, enums, уникальность keys, корректные references, нет запрещённых блоков |
| Общая сущность к публикации | Уникальный routeSlug, официальные ресурсы, категория, валидный mapping; common product/category/comparison можно опубликовать до языкового материала |
| Продукт к публичной выдаче | Published common entity и готовый published en-контент, обязательные блоки/источники, noPackageReason без SDK; иначе публичного URL нет |
| Контент к публикации | locale разрешена; summary/SEO не пусты; источники и reviewedAt есть; ссылки на опубликованные продукты разрешены; рендер preview без сломанных блоков |
| Сравнение к публикации | Пара уникальна; оба en-продукта публично готовы и входят в categoryId; минимум три содержательных строки покрывают обе CMS; вывод и условия выбора не пусты; источники валидны |
| Сравнение к индексации | indexingRequested=true + содержательный taskContext, минимум три критерия, ограничения и самостоятельный verdict; редактор подтверждает ценность; автоматический валидатор не определяет качество аргументов |
| Раскрытие | Если участник сравнения — Sanity, на котором построен сайт, `disclosure` заполнен по редакционному чек-листу; текст показывается над выводом |
| Главная | Один первый hero, лимит/типы секций, только опубликованные references, нет CTA неподключённой возможности |
| Смена slug / снятие публикации | Нет коллизии/цикла redirect; связанные URL и страницы обработаны; sitemap и кеш обновляются |

Неполные метрики или AI-проверка не блокируют полезную карточку: UI обязан объяснить состояния. Но публикация сайта без методологии AI-readiness блокируется общей релизной приёмкой. Время reviewedAt не может быть в будущем.

Studio-валидация помогает редактору, но не заменяет проверки на пути публикации и в публичной read model. Проект должен иметь контролируемое publish-действие, повторную проверку revision и диагностику ошибки. Common entity публикуется первым, затем locale-content; публичная выдача появляется только при готовой паре. Это устраняет цикл «entity требует published content → content требует entity». Ссылки на альтернативы/сравнения фильтруются по публичной готовности; наличие reference не обещает публичный URL. Возможность обойти UI прямой записью администратора признаём: импорт ограничивается кодом/секретами, а нарушения отслеживаются проверкой опубликованного dataset; бесплатные custom roles не предполагаются.

После публикации событие инвалидирует продукт, категорию, связанные сравнения, главную и SEO-выдачу по зависимостям. При сбое invalidation действует резервный TTL и повтор обработки. Конкретный webhook и задержка обновления ещё не проверены.

## 8. Примеры доменных документов

Имена и URL ниже синтетические; они иллюстрируют форму, не утверждают наличие реальной CMS или её инструментов.

```json
{
  "id": "prd_01", "displayName": "Example CMS", "routeSlug": "example-cms",
  "categoryIds": ["cat_cms"],
  "officialWebsiteUrl": "https://cms.example.org/",
  "officialDocsUrl": "https://cms.example.org/docs/",
  "hostingModels": ["cloud", "self_hosted"], "apiStyles": ["rest"],
  "packageIds": ["pkg_01"], "primaryPackageId": "pkg_01",
  "repositoryIds": ["repo_01"], "primaryRepositoryId": "repo_01"
}
```

```json
{
  "id": "pkg_01", "productId": "prd_01", "packageName": "@example/cms-sdk",
  "role": "primary_js_sdk", "officialSourceUrl": "https://cms.example.org/docs/sdk/"
}
```

```json
{
  "id": "content.product.prd_01.en", "productId": "prd_01", "locale": "en",
  "summary": "A headless CMS for structured website content.",
  "useCases": ["Content-driven websites"],
  "fitsWhen": ["Editors need reusable structured content."],
  "avoidWhen": ["The team cannot operate the required backend."],
  "limitations": ["Hosting responsibilities depend on the deployment model."],
  "integrationNotes": "Use the documented JS SDK and verify preview support.",
  "criteriaBlocks": [
    {"key":"deployment","body":"Validate the deployment responsibilities.","sourceKeys":["sdk"]},
    {"key":"content_model","body":"Validate the content model.","sourceKeys":["sdk"]},
    {"key":"editorial_workflow","body":"Validate preview and publication.","sourceKeys":["sdk"]},
    {"key":"js_ts","body":"Validate the JS/TS SDK.","sourceKeys":["sdk"]},
    {"key":"localization_access","body":"Validate locale and access requirements.","sourceKeys":["sdk"]},
    {"key":"cost_limits","body":"Validate scenario-specific limits.","sourceKeys":["sdk"]},
    {"key":"agent_support","body":"See the separate AI review.","sourceKeys":["sdk"]}
  ],
  "sources": [{"key":"sdk","title":"Official SDK docs","url":"https://cms.example.org/docs/sdk/","accessedAt":"2026-10-05T10:00:00Z"}],
  "alternativeIds": ["prd_02"], "reviewedAt": "2026-10-05T10:00:00Z",
  "seo": {"title":"Example CMS: use cases and limitations | PkgCompass","description":"Explore Example CMS, its integration model and documented limitations."}
}
```

В примере строка `integrationNotes` иллюстрирует текст; в Sanity она сериализуется разрешёнными Portable Text blocks. Рабочий контракт массивов useCases/fitsWhen/avoidWhen/limitations — `{key, text}` с непустым plain text; строки в доменном примере — сокращённое представление. Summary и SEO — plain text; integrationNotes, criteriaBlocks[].body, taskContext и verdict — Portable Text. Эти короткие синтетические строки демонстрируют форму, не готовность материала к публикации. В criteria ячейки содержат plain text, choiceGuidance содержит `{productId, conditions:[{key,text}]}`.

```json
{
  "id": "cmp_01", "productIds": ["prd_01", "prd_02"],
  "pairKey": "[\"prd_01\",\"prd_02\"]", "categoryId": "cat_cms",
  "displayOrder": ["prd_02", "prd_01"]
}
```

Для двух slug `example-cms` и `other-cms` URL пары — `/en/compare/example-cms-vs-other-cms/`, даже когда первым показан `prd_02`. Пример содержимого сравнения ниже иллюстрирует структуру, но короткие синтетические аргументы не являются готовым редакционным материалом для индексации.

```json
{
  "id": "content.comparison.cmp_01.en", "comparisonId": "cmp_01", "locale": "en",
  "title": "Example CMS vs Other CMS for an editorial website",
  "taskContext": "A small team needs a structured publishing workflow.",
  "criteria": [{"key":"deployment","label":"Deployment responsibilities","cells":[
    {"productId":"prd_01","text":"Validate the selected deployment model.","sourceKeys":["exampleDocs"]},
    {"productId":"prd_02","text":"Validate the hosted service constraints.","sourceKeys":["otherDocs"]}
  ]}],
  "choiceGuidance": [
    {"productId":"prd_01","conditions":["The team can maintain its chosen deployment."]},
    {"productId":"prd_02","conditions":["The hosted constraints fit the publishing workflow."]}
  ],
  "limitations": ["Run a preview and permission prototype before choosing."],
  "verdict": "Choose after validating the operational requirements of the workflow.",
  "sources": [
    {"key":"exampleDocs","title":"Example documentation","url":"https://cms.example.org/docs/","accessedAt":"2026-10-05T10:00:00Z"},
    {"key":"otherDocs","title":"Other documentation","url":"https://other.example.org/docs/","accessedAt":"2026-10-05T10:00:00Z"}
  ],
  "reviewedAt":"2026-10-05T10:00:00Z", "indexingRequested":false,
  "seo":{"title":"Example CMS vs Other CMS | PkgCompass","description":"Compare documented deployment constraints for an editorial website."}
}
```

Структура метрик описана в 06, AI-review — в 07. В Sanity текстовые поля этих доменных примеров маппятся в соответствующий Portable Text или plain-text тип схемы.

## 9. Критерии приёмки

- Seed с scoped npm-именем создаёт продукт, пакет, repository и en-контент; повтор не создаёт дубликат и не меняет редакторскую правку.
- Смена npm-имени сохраняет продуктовый URL; смена slug создаёт 308 для карточки и выбранных пар.
- A/B и B/A не создают два сравнения; displayOrder не меняет pairKey; коллизия slug/pair блокируется.
- Draft с отсутствующим обязательным блоком сохраняется, публикация блокируется; авторизованный preview его показывает, публичная read model — нет.
- Повтор импорта не меняет reviewedAt/summary/slug, отказ источника не удаляет прежнее валидное значение; неполный AI score=null.
- Добавление черновика другого языка не меняет ID продукта и метрики и не создаёт публичный перевод; ссылки главной не ведут на неопубликованный продукт.
- Published-валидация ловит обход UI; webhooks/revisions и обновление кеша подтверждены сквозным прототипом перед релизом.

Document-level локализация принята в ADR 0009; IDs/taxonomy/набор/URL определены этим контрактом и ADR 0005/0006/0008. Publish action проверяет readiness и revision, публичный repository повторно проверяет readiness. API/SDK проверяются прототипом; открытых структурных решений для старта нет. Privacy page использует pageKey=privacy, locale=en, sections=[richText с Portable Text body], seo; обязателен действующий contact владельца по 09.
