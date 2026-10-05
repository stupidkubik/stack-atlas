# PkgCompass: AI-readiness v1

Дата: 5 октября 2026. Контракт по ADR 0002, [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md) и [ADR 0014](decisions/0014-learning-project-simplifications.md). Проверки выбранных CMS пока не выполнены.

## 1. Значение и формула

Это редакционный индекс наличия средств поддержки coding-агентов, а не эффективность генерируемого кода, качество или безопасность CMS. Веса выбраны проектом. Сигналы, доказательства и ограничения обязательны рядом с числом.

Версия `cms-ai-support-v1`; `score = round(100 × (25 × types + 20 × llmsTxt + 20 × mcp) / 65)`, округление один раз, половина вверх.

| Сигнал | Вес | Завершённая проверка |
| --- | --- | --- |
| Типы основного SDK | 25 | bundled = 1, external `@types` = 0.5, none = 0 |
| Официальный llms.txt | 20 | present = 1, absent = 0 |
| Официальный MCP | 20 | present = 1, absent = 0 |

Все три present с bundled → 100; bundled + llmsTxt без MCP → 69; external + оба → 81; только bundled → 38. Неизвестный или ошибочный обязательный сигнал → `score = null`, знаменатель 65 не пересчитывается. Нет сопоставимого SDK → `not_applicable` и `score = null`.

## 2. Ручной workflow вместо детекторов

Редактор проверяет источники и записывает `aiReview` в Studio. Черновик может быть неполным, а публикация положительного или отрицательного вывода требует evidence. Пока новый review — черновик, посетитель видит прежнюю опубликованную версию. Публичное чтение использует только опубликованный review напрямую из Sanity; в БД он не копируется.

Для типов фиксируем выбранную версию основного SDK и документированные entry points; проверяем поставляемые declarations и разрешение импортов минимальным TypeScript fixture. При external проверяем соответствующий `@types` в том же fixture. Не выводим отсутствие из одного поля `types` и не используем TS-исходники репозитория как доказательство опубликованного пакета. Fixture запускается оператором в изолированной директории, без lifecycle scripts; автоматическая распаковка и детекция не входят в v1.

llms.txt проверяем по официальной документации, включая `/docs/llms.txt` при наличии. Для present нужны H1, полезное содержимое и официальная принадлежность. Для absent фиксируем проверенные URL и область поиска: один 404 не доказывает отсутствие везде. Таймаут или 403 — error.

MCP подтверждаем ссылкой с официального ресурса CMS на конкретный инструмент, его владельца и область применения. Реестр — источник кандидатов, совпадение имени не доказательство. MCP не запускаем. Community-инструмент можно показать отдельно, официального балла он не даёт.

Источники метода: [TypeScript publishing](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html), [module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html), [llms.txt](https://llmstxt.org/), [MCP Registry authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx).

## 3. Данные и состояния

Sanity `aiReview`: `id = ai_review.<productId>`, `productId`, `mappingKey`, `methodologyVersion`, `signals`, `reviewedAt`, `reviewerLabel`, `overrideReason?`, `previousFinding?`. `mappingKey` вычисляет publish action по [06](06-data-pipeline.md) из подтверждённых SDK и source identity; вручную редактор hash не вводит. Каждый signal: `key`, `state`, `kind?` для types, `checkedAt` / `null`, `scope`, `reason?`, `evidence[]`. Evidence: `sourceUrl`, `officialSourceUrl?`, `finding`, `checkedAt`, `packageVersion` / `entryPoints?`; отрицательное finding перечисляет проверенную область. В публичной записи нет email редактора, приватных заметок и секретов.

| state | Значение |
| --- | --- |
| present | Проверено положительное доказательство |
| absent | Не найдено в завершённой заявленной области, с протоколом проверки |
| unknown | Ещё не проверено либо неоднозначно |
| error | Попытка не завершена из-за сети, доступа или невалидного ответа |
| not_applicable | Нет сопоставимого SDK, подтверждённая причина |

Read layer вычисляет из опубликованного review:

- `completeness = complete` только при трёх present/absent и применимом mapping; иначе `incomplete` либо `not_applicable` при отсутствии SDK. Балл считает приложение, редактор его не вводит.
- Если `mappingKey` review не совпадает с текущим mapping, все сигналы показываются как `unknown` с причиной `mapping_changed`, `score = null`. Нужен новый review; старые сигналы под новым mapping не показываются.
- `evidenceAsOf` — самая ранняя `checkedAt` обязательных сигналов полного review; для неполного — `null`.
- Свежесть — 90 дней от `evidenceAsOf`. Старше — пометка «Checked over 90 days ago», балл остаётся с датой. Studio подсвечивает review старше 75 дней.

Исправление — новый опубликованный review с причиной; прошлый finding сохраняется в поле `previousFinding` этого документа. Бессрочный audit trail не обещается. Новый сигнал или новые веса требуют новой версии методологии.

## 4. Публичная методология и приёмка

`/en/methodology/ai-readiness/` объясняет область, веса, примеры, отсутствие доказанной эффективности, неполные состояния, даты и срок свежести. Карточка даёт ссылки на evidence; сравнение не ранжирует разные версии методологии и неприменимые оценки. AI-балл не определяет готовность карточки к индексации.

Проверяем расчёт 100/69/81/38/null; bundled/external; absence против error; not_applicable; official против community; `mapping_changed`; пометку свежести на границе 90 дней. К релизу у каждой CMS есть опубликованный review, допускающий честные unknown/error/not_applicable; числовой итог не обязателен. Методология и понятные состояния обязательны.

Context7, skills, AGENTS.md и автоматические детекторы — расширения с отдельной приёмкой.
