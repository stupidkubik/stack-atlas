# PkgCompass: итоговая сверка документации

Дата: 5 октября 2026. Проверка после согласованного пересмотра v1. Это аудит спецификаций, не верификация работающего приложения.

## 1. Вывод

Документационных блокеров для начала реализации не обнаружено. Обязательный v1: английский каталог 5–8 CMS / 3–5 сравнений, CMS/preview/публикация, SEO/качество, ограниченный импорт, ручной AI-review, форма→Brevo, consent/PostHog и accepted conversion. Реальная локализация, A/B и подписка остаются расширениями и не заявляются реализованными.

Авторитетное решение — [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md); точные контракты — 02–12. Прежние ADR 0001/0002/0004/0009/0010/0012 сохранены с отметками о частичной замене, концепция явно историческая. Остальные ADR совместимы с текущей рамкой.

## 2. Цельный проход

Проверены концепция, реестр, разбор, scope, сценарии, модель, архитектура, pipeline, методология, SEO, новые форма/измерение, приёмка, эксплуатация, README и ADR 0001–0013. Naming не определяет runtime scope и остаётся исторической проверкой названия.

| Область | Согласованный результат |
| --- | --- |
| Цель → scope → кейс | Контентная платформа и измеряемое действие; путь до CRM входит в прототип/v1 |
| In/out → приёмка | Локализация/A/B/рассылка/детекторы/ledger/resume не являются release gates |
| Страницы → URL → sitemap | request-shortlist200/index; privacy200/noindex; accepted не отдельный URL |
| Модель → публикация | Common entity публикуется до locale-content; публичный guard требует готовую пару, без циклического prerequisite |
| Сравнения → SEO | Минимум три критерия+вывод; неготовое404; готовое opt-out indexingRequested=false200/noindex |
| Источники → снимки → UI | Stable ID, semantic mappingKey, last-valid с исходной датой, 0/null различаются |
| AI-review → collector → UI | Published ручной review; mapping/revision match; pending/unknown вместо нового ложного балла |
| Pipeline → эксплуатация → тесты | Один snapshot writer/lock; новый сбор после crash, без receipts/pointers/reconciliation |
| Форма → CRM → события | Accepted только CRM success; lease/дедуп/повторы отдельно от collector; один conversionId на retained operation |
| Consent → атрибуция → воронка | SDK/события только granted; withdrawal cleanup; PII/query/referrer запрещены; raw UTM не хранятся |
| Операционный учёт → аналитика | Все accepted DB requests отдельно от consenting 7-day funnel; exactly-once сети не обещаем |
| Targets → права → private data | Development/production изолированы; public reader не читает leads; preview drafts server-only |
| Retention → cleanup → restore | Snapshots30d с fallback, leads30d, encrypted lead backups7d, analytics90d, reports14d |
| Оценка → план | 64–106h как новая гипотеза, пересчёт после прототипа; 3–5 дней не обещаем |

Устранены найденные неоднозначности: цикл публикации сущностей/контента; публичная оболочка неготового сравнения без поля модели; mapping change при переносе старого AI-review; поздний CRM failure после accepted; повтор/потеря CRM-ответа; сохранение общего контакта при нескольких сценариях; privacy pageKey/sections; свойства development analytics; устаревшие S1–S9 prerequisites и имена операционных записей.

## 3. Автоматические проверки

Автоматический проход: 30 Markdown-файлов, 124 локальные ссылки/anchors, 5 JSON-примеров и 42 таблицы — ошибок не найдено. Также проверены существование файлов, парность fenced blocks, trailing whitespace и завершающие newlines. Отдельным поиском проверены старые active requirements: importRunId/attemptId/mappingRevision, ledger/receipts/pointers/180-day history/A→B/перенос analytics. Они не остались действующими требованиями; встречаются только в историческом тексте или явном списке исключений.

## 4. Что ещё предстоит выполнить

Код/lockfile, account setup/quotas/budget, real API fixtures/mapping, макеты, CRM/analytics dashboard, preview/webhook smoke, migrations, restore/deletion и Q01–Q19. Эти задачи имеют выбранный контракт и способ проверки; они не требуют новой продуктовой развилки перед стартом. Domain purchase не обязателен, Vercel origin достаточен.

Непройденные проверки реализации или недоступный account могут стать фактическим блокером релиза; их наличие нельзя исключить аудитом markdown. Безопасность drafts/PII, честный CRM success и отсутствие событий без consent остаются обязательными gates. Итог этого прохода — документация готова к реализации, а не «production уже готов».
