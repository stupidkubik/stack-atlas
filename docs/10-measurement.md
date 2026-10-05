# PkgCompass: consent и измерение v1

Дата: 5 октября 2026. Обязательный контракт по [ADR 0013](decisions/0013-marketing-v1-and-simple-pipeline.md). Провайдер — PostHog Cloud EU; аккаунт/дашборд пока не настроены. Это продуктовый режим сбора, не декларация юридического соответствия.

## 1. Consent lifecycle

unknown и denied: PostHog SDK не загружается/не инициализируется; нет analytics requests, anonymous IDs, UTM persistence и experiment state. Cookie consent_v1 хранит только granted/denied и версию политики на 180 дней, Secure/SameSite=Lax, без visitor ID. До выбора обе кнопки «Accept analytics» / «Reject analytics» доступны равноценно. Ссылка Privacy settings в footer позволяет изменить выбор.

granted: lazy-load PostHog, вручную разрешённые события, anonymous ID; autocapture, automatic pageviews, session replay, surveys и feature flags выключены. SDK не получает email и identify не вызывается. Публичный HTML и форма работают независимо от SDK. Все automatic URL/referrer properties отключены/санитизированы before_send allowlist; full query, search text и referrer URL не передаются.

withdraw: остановить capture, выключить/очистить SDK persistence и session attribution/dedupe state, сохранить только denied consent cookie. Удалить известные SDK cookies/localStorage keys; после перезагрузки SDK не стартует. Отложенные callback re-check текущий consent, очередь старых событий удаляется. Нет отправки исторических событий при последующем opt-in. Consent проверяется в момент события, а не только при init.

Основание возможностей: [PostHog privacy](https://posthog.com/docs/privacy), [JS configuration](https://posthog.com/docs/libraries/js/config). Точные SDK config/cleanup keys фиксируются lockfile и проверяются сетевым тестом; нельзя полагаться на defaults.

## 2. Схема событий

track(name, properties) имеет типизированный allowlist и runtime validation. Common fields: eventSchemaVersion=1, environment=development|production, routeType, entityId?, locale=en, occurredAt, eventId UUID. SDK anonymous distinct_id допускается только после согласия. routeType=home|catalog|library|comparison|methodology|lead_form|privacy; entityId только собственные стабильные catalog IDs.

| Событие | Когда | Дополнительные свойства |
| --- | --- | --- |
| page_viewed | После согласия, при смене route; один раз на navigation | routeType, entityId? |
| comparison_viewed | При открытии опубликованного сравнения | comparisonId |
| official_resource_clicked | Перед переходом к официальному источнику | libraryId, resourceType=docs / website |
| lead_form_viewed | При открытии страницы формы | entryPoint=nav / comparison / library / home |
| lead_accepted | Ответ accepted собственного requestId, analyticsEligible=true, текущий consent granted | conversionId, scenario, campaignKey? |

Не отправляем событие простого submit как конверсию. Нет email, email hash, IP, CRM/contact/requestId, form values кроме scenario enum, пользовательского q, полного URL, arbitrary error text. conversionId — отдельный случайный UUID; он не является request credential. before_send запрещает незаданные SDK properties, исключение — технический anonymous distinct_id и нужные транспортные поля SDK.

UTM: только после согласия извлекаем utm_source/medium/campaign из текущего URL, сопоставляем комбинацию с локальным allowlist кампаний (v1: portfolio, demo), сохраняем campaignKey в sessionStorage до закрытия вкладки. Неизвестные значения отбрасываем; raw strings не отправляем в CRM/аналитику. Пока согласия нет, атрибуция не сохраняется, включая переходы; утраченная атрибуция не восстанавливается задним числом.

## 3. Конверсия и дедупликация

Основная конверсия — lead_accepted после CRM success по 09. Повтор собственного requestId использует прежний conversionId. Вкладка хранит sent conversion IDs только после согласия; eventId для lead_accepted детерминированно равен conversionId. Сетевые повторы возможны, отчёт считает уникальные conversionId, не raw events. Гарантия exactly-once event delivery не заявляется. Новый requestId дубликата не получает conversion и не выпускает событие.

Воронка: уникальные consenting anonymous visitors, открывшие сравнение → открывшие форму → CRM-принятая заявка того же anonymous visitor за 7 суток. Conversion rate = уникальные visitors с qualifying lead_accepted / уникальные visitors с comparison_viewed. Последовательность и окно проверяются в запросе дашборда. Заявки из nav/home считаются отдельным потоком; не вставляются в числитель comparison funnel без preceding comparison_viewed. Дополнительно считаем unique conversionId для объёма операций.

Отказ от consent, блокировщик, закрытие вкладки, server retry/operator action могут оставить принятую CRM-заявку без analytics event. Сервер не отправляет аналитику задним числом и не хранит anonymous ID вместе с email. Операционный отчёт по accepted DB requests — общий объём, analytics funnel — наблюдаемая согласившаяся аудитория. Эти числа не обязаны совпадать. Данные не доказывают uplift или статистическую значимость.

## 4. Дашборд и следующий эксперимент

К релизу нужен сохранённый dashboard: comparison funnel, unique conversions, official_resource_clicked, разрез campaignKey при наличии. Demo traffic отделён environment=development и отдельным PostHog project, production traffic не заполняется фиктивными успехами. Analytics retention — 90 дней, выставляется в доступных account settings; если план не позволяет, владелец применяет ежемесячное удаление данных старше 90 дней и проверяет этот путь до production.

A/B не входит в v1: нет варианта/cookie/exposure. После работающей воронки отдельная спецификация задаёт гипотезу, одну изменяемую переменную, consent-only устойчивое назначение, exposure и окно метрики, размер выборки и правило анализа. Общий кешируемый HTML сохраняет базовый вариант; отсутствие трафика не заменяется вымышленным результатом.

## 5. Приёмка

Network/storage tests: unknown, denied, granted, withdrawal/reload; callback после withdrawal не отправляет событие. Проверить route transition dedupe, отсутствие PII/query/referrer, UTM allowlist, успешную форму без consent, failed/pending без conversion, lost response retry и dedupe conversionId, правильные numerator/denominator/7-day window на synthetic events. Реальный dashboard smoke выполняется отдельно от CI. SDK сбой не ломает контент/форму и не отменяет CRM success.
