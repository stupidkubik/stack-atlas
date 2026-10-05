# Качество, эксплуатация и выпуск ядра

Дата: 5 октября 2026. Все задачи запланированы. Нормативные критерии: [11](../11-quality-plan.md), операции/retention: [12](../12-operations.md). План описывает исполнение этих контрактов, не отчёт их прохождения.

## QA-01 — CI и единый набор доказательств

**Зависимости:** FP-01, FP-02 и первый проход FP-03. Подключать сценарии вместе с CW/DP/LM до общего прототипа; полная DB/role matrix появляется после доменных таблиц и второго прохода FP-03.

1. Настроить PR: npm ci → lint/typecheck → unit/реальные DB integration на временном PostgreSQL → build → критические E2E/HTTP HTML/axe. Применять те же migrations, что dev/prod; live API не использовать в обычных PR.
2. Разделить fixture CI и вручную запускаемый trusted dev smoke. Untrusted PR не имеет live secrets и write credentials. Fixtures фиксируют clock, IDs и ожидаемые ответы; сбой первой попытки теста сохраняется, retry не превращает дефект в незаметный pass.
3. Подключить тесты доменных инвариантов и границ интеграций из потоков. Не тестировать зеркально реализацию и markdown-only изменения через полный браузерный pipeline.
4. Для каждого Q01–Q19 вести evidence record: commit/deployment/env, версия инструмента, сценарий/команда, pass/fail, очищенный trace/log и ограничения. У каждого gate должен быть владелец проверки и актуальный результат; пустое поле означает «не проверено».
5. Настроить artifact retention 14 дней, проверить отсутствие email, preview текста, headers, secrets и request credential в артефактах. Долгоживущая сводка для кейса содержит только безопасные результаты.

**Артефакты:** workflows, test matrix, evidence index и template результата. **DoD:** чистый checkout проходит fixture CI; нет production secrets; live smoke запускается отдельно; провал блокирует merge/release по назначению проверки. Покрывает инфраструктуру всех Q, но не автоматически закрывает их.

## QA-02 — Сквозная приёмка и отказные сценарии

**Зависимости:** FP-05 для начала walkthrough; окончательный проход требует CW-14, DP-08, LM-09 и restore evidence QA-04. Результаты accessibility/performance QA-03 присоединяются к общему release gate QA-05.

1. Пройти каталог/Back/reset/empty на desktop и mobile, продукт/сравнение/источники, CTA и форму, все URL/HTTP/readiness случаи. Проверить server HTML и sitemap по общему guard.
2. В двух независимых сессиях проверить public против preview, guest denial, publish/unpublish/rename и подпись/repeat webhook; измерить обновление ≤60s. Проверить TTL и сбой import invalidation.
3. В DB integration принудительно воспроизвести конкуренцию collector/cleanup, crash, mapping change, incomplete source window, null/0 и AI pending. Провести live API smoke при изменении adapters; fixture pass его не заменяет.
4. В fake CRM/DB воспроизвести lease races, late failure после accepted, потерю ответа/commit, attempt cap, duplicate и deletion; live CRM проверять только собственным dev alias. Проверить форму без consent, invalid/checkbox/honeypot/rate-limit.
5. Network/storage проверки всех consent переходов, deferred callback, no-PII allowlist, route/conversion dedupe, synthetic 7-day funnel; real dashboard smoke отдельно. Сравнить операционный accepted count и аналитический unique count с объяснением разных аудиторий.

**Артефакты:** Q01–Q17 evidence с негативными сценариями, исправленные дефекты, редакционная проверка контента. **DoD:** нет незакрытых correctness/security нарушений; live и fixture результаты не смешаны; ни draft leak, ни ложный success/score, ни analytics без consent не принимаются как известное допустимое ограничение.

## QA-03 — Доступность и performance

**Зависимости:** CW-15 и LM-08 для полного критического пути. Baseline снять на прототипе; окончательно проверить перед release. Использовать web evidence CW-15 и дополнить интеграционной проверкой, не выполнять неизменившиеся проверки второй раз.

1. axe на критических страницах/состояниях без unresolved serious/critical; moderate разобрать вручную. Проверить контраст, landmarks/headings, сравнение с headers, подписи/ошибки/status, focus/skip link, reflow.
2. Ручной VoiceOver+Safari путь nav → filters → CMS → comparison → form → consent/withdrawal. Проверить 320 CSS px, text zoom 200%, reduced motion; сохранить безопасную сводку, не называть её полной WCAG-сертификацией.
3. Production build, закреплённый Chrome/Lighthouse и config: mobile 412×823, simulated throttling, холодный browser/прогретый server; три прогона home/catalog/library/comparison/form, медиана. Повторить с granted SDK, отдельно cold server.
4. Цели LCP≤2.5s, CLS≤0.1, TBT≤200ms из 11. При нарушении исправить причину или явно пересмотреть бюджет до release; TBT не выдавать за INP, lab за field CWV. После изменения render/assets/SDK повторять затронутые проверки.

**Артефакты:** accessibility record, pinned perf config и отчёты. **DoD:** Q18/Q19 соответствуют контракту; ограничения сформулированы честно. RUM/новая платформа наблюдения не обязательны.

## QA-04 — Maintenance, backups и restore rehearsal

**Зависимости:** DP-08, LM-09 и второй проход FP-03 с проверенными правами. Cleanup/backup интерфейсы должны быть доступны; restore rehearsal DP/LM и этой задачи выполняется совместно и закрывается одним набором evidence. Закончить до production.

До production rehearsal использует dev/test backups и изолированную test DB/CMS namespace, без production private data. Production расписания backup включаются в QA-05 после создания соответствующих targets; они используют уже проверенный restore path.

1. Связать planned CLI из 12 с реальными scripts и проверить в чистом checkout. Все write targets явные; dry-run не меняет БД/CMS/CRM/cache. Отдельные credentials и lease для lead maintenance; snapshot cleanup использует collector lock.
2. Настроить Actions workflow_dispatch/daily metrics/weekly AI/daily maintenance; collector concurrency `collector-<env>`, cancel-in-progress=false. Включить стандартные account failure notifications владельцу; новых email/Slack integrations не создавать.
3. Перед schema/cleanup изменениями и еженедельно сохранять content/snapshot backup с окном 30 дней. Private leads — daily encrypted backup на 7 дней, ключ отдельно в закрытом operator storage, без public CI artifacts и rate-limit history. Проверить стоимость/доступ storage.
4. В изоляции остановить handlers/collectors, восстановить CMS namespace и SQL test DB, проверить IDs/mappingKey/fallback/public-read запреты. Восстановленные lease сбросить, expired leads и соответствующие CRM data удалить до включения; replay тестировать fake CRM. Потерянные metrics допускают новый сбор, потерянный private accepted state требует backup.
5. Проверить project-only и shared CRM contact deletion, последнюю retained заявку, повтор после CRM error, операторское удаление и очистку после restore. Проверить analytics retention90d или доступный ежемесячный delete path; reports14d/rate limits24h.
6. Описать диагностику/возврат к работе после source/lock/mapping/review/invalidation/CRM/backup ошибок. Команды cache:refresh/leads:retry/maintenance/backup/restore должны быть реальны, не placeholders. Назначить владельца ежедневной проверки свежести/ошибок/CRM и месячного analytics deletion, если требуется.

**Артефакты:** runbook README, расписания, закрытый backup inventory, sanitized restore/deletion record. **DoD:** Q10/Q17 и соответствующие Q09/Q13 пройдены; backup восстановлен, а не только создан; шаги воспроизводимы без доступа public reader к PII.

## QA-05 — Production подготовка и release gate

**Зависимости:** CW-15 (включая контент CW-13), DP-08, LM-09, QA-01–QA-04 для выпуска. Подготовка targets может идти заранее; выпуск только после проверки зависимостей.

Эта задача выполняется в два прохода: шаги 1–2 готовят production targets/origin для финальных CW/QA проверок; шаги 3–6 выпускают уже проверенный release candidate. CW-14/CW-15 используют конфигурацию первого прохода, а не ждут завершённого QA-05. Таким образом production smoke и общий gate не создают циклической зависимости.

1. Создать отдельные production CMS/Neon/Brevo/PostHog targets, schema migrations/roles и secrets. Записать quotas/budget, реальный PRIVACY_CONTACT_EMAIL, SITE_URL (Vercel origin достаточен), подписанный webhook и preview. Не переносить dev leads/analytics или alias в production; editorial content переносить контролируемо по stable IDs.
2. Проверить production origin metadata/canonical/robots/sitemap, отсутствие draft и секретов, readonly/lead credentials и отключённые CRM campaigns. Настроить расписания и backups именно для production targets.
3. Собрать release candidate; заполнить Q01–Q19 evidence matrix и checklist контента 5–8 CMS/3–5 сравнений. Непроверенные live integration/restore, нарушения privacy/security/critical accessibility и ложные accepted/score блокируют выпуск.
4. Подготовить конкретный reviewable deployment и release notes. Этот план не выполняет публикацию и не даёт новой авторизации на неё: в будущей реализации сверить разрешение владельца перед внешним выпуском, учитывая уже данные инструкции. Никаких платных upgrades автоматически.
5. После разрешённого deploy выполнить production HTTP smoke home/catalog/library/comparison/form/privacy/methodology/sitemap и guest draft denial. Real form smoke только собственным production test адресом владельца, с удалением; никаких чужих контактов/писем. Dashboard smoke только при явном consent.
6. При ошибке откатить совместимый app deployment; CMS/SQL/CRM rollback — отдельная процедура по runbook, не обещание автоматического отката данных. Повторить затронутые gates после исправления.

**Артефакты:** production inventory без секретов, release evidence, deployment reference и smoke record. **DoD:** Q01–Q19 подтверждены на подходящих уровнях, production smoke пройден, incident recovery доступен; принятие релиза фиксируется фактом, не планом.

## QA-06 — Публичный кейс и закрытие v1

**Зависимости:** QA-05.

1. Проверить Git history/fixtures/artifacts на secrets/PII перед разрешённым переводом репозитория в public; очистка текущих файлов не заменяет проверку истории. Документировать запуск, работающие команды, подтверждённые ограничения и результаты.
2. Подготовить кейс CMS publish → SEO page → CRM accepted → consented funnel с безопасными иллюстрациями/evidence; не показывать реальные заявки и draft content. Долгоживущую сводку сохранить до истечения 14-дневных артефактов.
3. Указать, что /en/ не означает переводы, synthetic funnel не доказывает uplift, SDK downloads не равны CMS users, analytics counts не равны всем accepted leads. Локализация/A-B/newsletter остаются отдельными следующими итерациями без пустых модулей.
4. Обновить статус задач по факту и остаток backlog; README не называет возможности реализованными до проверок.

**Артефакты:** README/portfolio case, безопасный release report и последующий backlog. **DoD:** кейс отражает работающий v1 и воспроизводимые доказательства, а не цели спецификации.
