# PkgCompass: приёмка v1

Дата: 5 октября 2026. Контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). Это план, не отчёт пройденных проверок.

## 1. Матрица требований

| ID | Проверка | Уровень / доказательство |
| --- | --- | --- |
| Q01 | Поиск/фильтры, reset, back, empty, stable URL | E2E desktop/mobile |
| Q02 | Карточка/сравнение с выводом и источниками, broken references исключены | Domain + editorial review |
| Q03 | Slug rename, reverse pair, query, absent locale, readiness | HTTP/HTML SEO tests |
| Q04 | SSR title/canonical/robots/lang/JSON-LD, sitemap только indexable | HTML tests + release smoke |
| Q05 | Draft не в public HTML/API/OG/sitemap/cache, guest preview denied | Две независимые сессии, real CMS smoke |
| Q06 | Публикация/снятие/rename, webhook signature/repeat, stale cache | Integration + real latency ≤60s после webhook |
| Q07 | Seed повтор без дублей/перезаписи; dry-run без mutations | Integration CMS fake + real dev |
| Q08 | Источники/окна npm, scoped SDK/monorepo, 0 vs null, смена mapping | Fixtures + live smoke 3–5 CMS |
| Q09 | Error сохраняет last-valid/дату, новый запуск после crash; lock busy без записи | DB integration, один writer |
| Q10 | Cleanup сохраняет fallback/complete AI; snapshot backup restore либо повторный сбор | DB restore rehearsal |
| Q11 | Формула/evidence/complete/null, types external, official/community, pending review | Unit + Studio/read-layer integration |
| Q12 | Доступная форма, серверная валидация, permission checkbox, honeypot, rate limit | Unit/integration/E2E |
| Q13 | CRM success, timeout, DB failure, lease/duplicates, lost reply и attempt cap | DB + fake CRM; реальный dev CRM smoke |
| Q14 | No-consent успешная форма без событий; false success исключён | E2E network assertions |
| Q15 | Consent unknown/denied/granted/withdrawal/reload, late callback | Network + cookie/storage E2E |
| Q16 | Нет PII/query/referrer; UTM allowlist; event/conversion dedupe и funnel | Runtime schema + synthetic dashboard query + real smoke |
| Q17 | Private lead TTL/delete/restore, изоляция DB roles/CRM проектов | Integration + операторский rehearsal |
| Q18 | Доступность критического пути | axe и ручная клавиатура/скринридер |
| Q19 | Производительность и release smoke | Lighthouse + production HTTP |

Нет тестов на receipts/pointers/hash-conflicts/resume/reconciliation, 90-day graphs, A/B, переводы и DOI: этих возможностей в v1 нет. Исключённая возможность не является release gate.

## 2. Fixtures и реальные интеграции

CI: synthetic CMS, API fixtures, fake CRM, stub analytics и локальный/временный PostgreSQL с реальными migrations. Набор: обычный/scoped SDK, monorepo, CMS без SDK, полный/неполный review, draft, rename, сравнение, CRM duplicates/errors, clock/lease/consent. Внешние запросы не выполняются в обычном PR. Фиксируем UTC clock и порядок ID.

Real dev smoke в прототипе: 3–5 CMS/mapping; seed → collect → Studio publish/preview/webhook; заявка → выделенный Brevo list; consent → отдельный PostHog dev dashboard. Сохраняем очищенные API fixtures/даты. Не называем mocked CRM реальной интеграцией. Live ошибки исправляются в прототипе, а не превращаются в неопределённый продуктовый scope.

Изменение source adapter/config требует соответствующего smoke и обновления fixture; нестабильный внешний API не запускается во всех PR. Retry runner не скрывает критическую ошибку; первая неудача сохраняется.

## 3. Доступность и performance

Цель — применимые WCAG 2.2 AA критерии критического пути: headings/landmarks, labels/errors/status, focus, keyboard, contrast, reflow, comparison headers. axe без unresolved serious/critical; moderate проверяются вручную. Ручной профиль VoiceOver+Safari: nav→filters→CMS→comparison→form→consent/withdrawal. Проверить 320 CSS px, text zoom 200%, reduced motion. Автоматический отчёт не объявляется полным сертификатом доступности. [WCAG](https://www.w3.org/TR/WCAG22/).

Lab бюджеты: LCP≤2.5s, CLS≤0.1, TBT≤200ms на home/catalog/library/comparison/form, включая granted consent. Production build, pinned Chrome/Lighthouse, mobile 412×823, Lighthouse mobile simulated throttling, холодный browser и прогретый server cache; три прогона, медиана, все отчёты сохранены. Cold server проверяется отдельно. Первая prototype baseline фиксирует config; если бюджет нарушен — исправление или документированный пересмотр до release, не ложный pass.

Полевые CWV не заявляются пройденными без выборки; TBT не заменяет INP. Web-vitals/RUM можно добавить позже, они не являются обязательной подсистемой v1. [Web Vitals](https://web.dev/articles/vitals).

## 4. CI и release gates

PR: npm ci → lint/typecheck → unit/DB integration → build → критические E2E/HTML/axe. Секреты production отсутствуют; untrusted PR использует fixtures. Performance запускается по изменениям render/assets/SDK и перед release, не для каждой правки markdown.

Прототип закрывает Q05–Q09/Q11/Q13–Q16 в одном сквозном пути до масштабирования контента. Перед release Q01–Q19 проверены, контент готов, origin/privacy contact настроены, production изолирован, export/restore/lead deletion проверены, account quotas/budget записаны, команды runbook воспроизводимы. После release smoke home/library/comparison/form/privacy/methodology/sitemap и guest draft denial; без отправки писем или реальной тестовой заявки третьему лицу.

Релиз блокируют фактические нарушения: draft/secret/PII leak; перезапись editorial; неверные canonical/score; ложный CRM success; события без consent; дубли операционной конверсии; потеря private lead state без восстановления; недоступный critical path; непроверенные real integration/restore. Это условия качества реализации, не открытые решения в документации. Удалять эти gates ради формулировки «без блокеров» нельзя.

## 5. Evidence

Записываем commit/deployment/environment, версии, сценарий Qxx, команда, pass/fail, очищенные logs/trace/screenshots, latency/budget и ограничения. Artifact retention 14 дней; долгоживущий portfolio report содержит только безопасную сводку. Email, draft text, headers/secrets, request credential не сохраняются в публичных артефактах. README сообщает только прошедшие проверки.
