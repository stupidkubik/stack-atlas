# PkgCompass: AI-readiness v1

Дата: 5 октября 2026. Контракт по ADR 0002 и [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). Проверки выбранных CMS пока не выполнены.

## 1. Значение и формула

Это редакционный индекс наличия средств поддержки coding-агентов, а не эффективность генерируемого кода, качество или безопасность CMS. Веса выбраны проектом. Сигналы, доказательства и ограничения обязательны рядом с числом.

Версия cms-ai-support-v1; score = round(100 × (25 × types + 20 × llmsTxt + 20 × mcp) / 65), округление один раз, половина вверх.

| Сигнал | Вес | Завершённая проверка |
| --- | --- | --- |
| Типы основного SDK | 25 | bundled=1, external @types=0.5, none=0 |
| Официальный llms.txt | 20 | present=1, absent=0 |
| Официальный MCP | 20 | present=1, absent=0 |

Все три present с bundled →100; bundled+llmsTxt без MCP →69; external+оба →81; только bundled →38. Неизвестный/ошибочный обязательный сигнал → score=null, знаменатель не пересчитывается. Нет сопоставимого SDK → not_applicable и score=null.

## 2. Ручной workflow вместо обязательных детекторов

Редактор проверяет источники и записывает aiReview в Studio. Черновик сохраняется неполным; публикация положительного или отрицательного вывода требует evidence. Публичное чтение использует только published review. Еженедельный/ручной collector переносит review в AI snapshot по 06; запись review в Studio не запускает DB writer.

Для типов фиксируем выбранную версию основного SDK и документированные entry points; проверяем поставляемые declarations и разрешение импортов минимальным TypeScript fixture. При external проверяем соответствующий @types в том же fixture. Не выводим отсутствие из одного поля types и не используем TS-исходники репозитория как доказательство опубликованного пакета. Fixture запускается оператором в изолированной тестовой директории, без lifecycle scripts; универсальная автоматическая распаковка/детекция не входит в v1.

llms.txt проверяем по официальной документации, включая /docs/llms.txt при наличии. Для present нужны H1 и полезное содержимое, официальная принадлежность. Для absent фиксируем проверенные URLs и область поиска; один 404 не доказывает отсутствие везде. Таймаут/403 — error.

MCP подтверждаем ссылкой с официального ресурса CMS на конкретный инструмент, владельцем и областью применения. Реестр — источник кандидатов, совпадение имени не доказательство. MCP не запускаем. Community-инструмент можно показать отдельно, он не даёт официальный балл.

Источники метода: [TypeScript publishing](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html), [module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html), [llms.txt](https://llmstxt.org/), [MCP Registry authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx).

## 3. Данные и состояния

Sanity aiReview: id=ai_review.<libraryId>, libraryId, mappingKey, methodologyVersion, signals, reviewedAt, reviewerLabel, overrideReason?, previousFinding?. mappingKey вычисляет publish action по 06 и подтверждённым SDK/source identity; редактор не вводит hash вручную. При изменении mapping требуется новый review, старый нельзя переносить под новым mappingKey. Каждый signal: key, state, kind? для types, checkedAt/null, scope, reason?, evidence[]. Evidence: sourceUrl, officialSourceUrl?, finding, checkedAt, packageVersion/entryPoints?; отрицательное finding перечисляет проверенную область. В публичной записи нет email редактора, приватных заметок и секретов.

| state | Значение |
| --- | --- |
| present | Проверено положительное доказательство |
| absent | Не найдено в завершённой заявленной области, с протоколом проверки |
| unknown | Ещё не проверено либо неоднозначно; pending_review — reason |
| error | Попытка не завершена из-за сети/доступа/невалидного ответа |
| not_applicable | Нет сопоставимого SDK, подтверждённая причина |

completeness=complete только при трёх present/absent и применимом mapping; иначе incomplete либо not_applicable при отсутствии SDK. score вычисляет приложение/коллектор, редактор его не вводит. checkedAt снимка — дата переноса, evidenceAsOf — наиболее ранняя checkedAt обязательных сигналов полного review; для неполного/null. Свежесть определяется evidenceAsOf, перенос не освежает факты. TTL 14 дней; старый факт остаётся с подписью stale, не трактуется как новая проверка.

Review revision берётся из published Sanity _rev. Публикация нового review инвалидирует карточку/каталог/сравнения. Пока revision снимка не совпала с published review, UI показывает pending и прежнюю оценку как историческую. При неполном новом review текущий score=null, последний complete — отдельно. Источники разных review не объединяются.

Исправление — новый опубликованный review с причиной, прошлый finding сохраняется в этом документе для пояснения, предыдущие DB snapshots сохраняются по retention. Полный бессрочный audit trail не обещается. Новый сигнал или веса требуют новой версии методологии.

## 4. Публичная методология и приёмка

/en/methodology/ai-readiness/ объясняет область, веса, примеры, отсутствие доказанной эффективности, неполные состояния и даты. Карточка даёт evidence ссылки; сравнение не ранжирует разные версии/неприменимые оценки. AI score не определяет готовность карточки к индексации.

Проверяем расчёт 100/69/81/38/null; bundled/external; absence vs error; not_applicable; official vs community; pending revision; неизменность evidenceAsOf при повторном переносе. К релизу у каждой CMS есть опубликованный review, допускающий честные unknown/error/not_applicable; числовой итог не является обязательным. Методология и понятные состояния обязательны.

Context7, skills, AGENTS.md и автоматические детекторы — расширения с отдельной приёмкой.
