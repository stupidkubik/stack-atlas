# PkgCompass: development services and credentials

Справочник подготовки dev targets для FP-04. Срез официальных публичных документов проверен **5 октября 2026**. Публичные документы не подтверждают условия конкретного аккаунта. В текущем проходе прочитаны авторизованные Plan/Usage экраны; подтверждённые параметры перечислены в разделе «Проверенные параметры аккаунтов». Retention и runtime smoke отмечаются отдельно и не считаются проверенными по одному тарифу.

## Что подготовить сейчас и что отложить

Сейчас нужны отдельные development ресурсы для реализации CW/DP/LM и последовательного dev smoke:

| Сервис | Dev target | Минимальная настройка |
| --- | --- | --- |
| Sanity | Один PkgCompass project, dataset `development` | Studio и server указывают на один проект и dataset; только synthetic seed/draft |
| Neon | Отдельный PkgCompass project, development branch | PostgreSQL, миграции FP-03, отдельные DB login roles; production rows не копировать |
| Brevo | Dev requests list в отдельном dev account или изолированном account | Только три атрибута из 09; ни одна campaign/automation не использует этот список |
| PostHog | Cloud **EU**, отдельный development project | `https://eu.i.posthog.com`; consent-only SDK и только разрешённые события из 10 |

GitHub remote и Vercel project подключены; development-only Actions workflow подготовлен локально, на default branch пока отсутствует. Custom domain не требуется: сгенерированный Vercel URL достаточен как origin. Наличие production dataset/branch не подтверждает release readiness; production credentials и release smoke относятся к подготовке выпуска.

Ниже — owner handoff, а не отчёт о регистрации: никакие аккаунты или ресурсы здесь не создавались и условия сервисов за владельца не принимались.

## Регистрации и настройка по сервисам

### Sanity

1. В [Sanity Manage](https://www.sanity.io/manage) создать/выбрать личный project для PkgCompass; добавить dataset с точным именем `development`. Значения `SANITY_PROJECT_ID` и `SANITY_DATASET` — идентификаторы, не секреты. Studio использует те же значения через `SANITY_STUDIO_PROJECT_ID` и `SANITY_STUDIO_DATASET`; Studio авторизуется редакторской сессией Sanity, API токен для её запуска не нужен.
2. Free plan по текущей странице включает два **public-only** dataset; создание private dataset — функция Growth. Это не блокирует FP-04: dev содержит только синтетический каталог. Public dataset разрешает анонимное чтение опубликованных документов; это **не делает drafts публичными**. Для preview чтения draft/version документов нужен server-only token с read access, и preview-запрос не должен использовать CDN. Не помещать в dev dataset реальные заявки, приватный draft text или иные непубличные данные. [Datasets](https://www.sanity.io/docs/content-lake/datasets), [pricing](https://www.sanity.io/pricing), [draft mode](https://www.sanity.io/docs/visual-editing/implementing-draft-mode).
3. Создать отдельные project robot tokens: `SANITY_PREVIEW_READ_TOKEN` для server-side чтения drafts/version и `SANITY_SEED_WRITE_TOKEN` только для оператора/seed apply. Выдать минимальный доступ из доступных встроенных разрешений проекта; custom document roles не закладывать как бесплатную возможность. Не брать личный CLI token: он связан с пользователем и шире нужного. Robot token показывается при создании один раз; задать срок действия и сразу сохранить secret в менеджер секретов. [Authentication and tokens](https://www.sanity.io/docs/content-lake/http-auth).
4. Для publish/webhook cache invalidation создать webhook только на `development` dataset, с узким фильтром на опубликованные документы, которые действительно обновляют каталог. Задать shared random secret: Sanity подписывает запрос, но не присылает само значение. Сервер проверяет подпись по raw body. Доставка at-least-once; официальная рекомендация сообщает о двух retry с интервалом 30 секунд для retryable ошибок, поэтому обработчик должен быть идемпотентным. [Webhooks](https://www.sanity.io/docs/content-lake/webhooks), [best practices](https://www.sanity.io/docs/content-lake/webhook-best-practices).
5. В Studio API configuration не разрешать широкие CORS origins с credentials. Проверьте usage страницы проекта: на Free превышение ряда квот блокирует API/CDN до reset/upgrade; лимиты измеряются календарными месяцами UTC. Не подключать payment method/paid add-on для прототипа без отдельного согласования расхода. [Plans and payments](https://www.sanity.io/docs/platform-management/plans-and-payments).

**Region:** в публичных документах, проверенных для этого handoff, не найдено настройки выбора storage region при создании обычного Sanity project. Документ API CDN перечисляет edge locations, включая Belgium, но это описание CDN и само по себе не подтверждает primary storage location аккаунта. Для текущего synthetic dev target достаточно зафиксировать, что account-specific residency не проверена; если понадобится подтверждение data residency, получить его из проекта/договора Sanity, не делать вывод по CDN POP. [API CDN locations and limits](https://www.sanity.io/docs/content-lake/api-cdn).

### Neon / PostgreSQL

1. Войти в существующий Neon account владельца (историческая ADR 0012 говорит, что он есть; доступ/состояние проекта этим проходом не проверялись). Создать отдельный проект `PkgCompass`, не использовать посторонний проект. При выборе региона предпочесть Frankfurt `eu-central-1`, если регион доступен для данного account/plan; Vercel Frankfurt обозначается `fra1`. Это согласованная цель для задержки и расположения в Европе, а не обещание доступности региона или гарантия юридического residency.
2. Создать отдельную development branch schema-only либо пустую ветку под миграции и synthetic seed. Не ответвлять dev с данными production. Schema-only branching и pooler доступны в Neon, но проверить текущую доступность действия в выбранном проекте до применения. Ветки — не замена миграциям из FP-03. [Neon branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer).
3. Создать отдельные password-bearing connection URLs на один dev branch/database, сопоставив их ролям из текущего FP-03 `scripts/db/bootstrap-roles.sql`: `DATABASE_READ_URL` → `pkgcompass_public_reader` (metrics reader, pooled); `DATABASE_IMPORT_URL` → `pkgcompass_metrics_writer` (collector writer/lock, direct session); `DATABASE_LEAD_URL` → `pkgcompass_lead_writer` (lead writer/maintenance, pooled); `DATABASE_MIGRATION_URL` → `pkgcompass_migration_owner` (migration owner, direct). Не переиспользовать owner password между ролями. Скрипт bootstrap создаёт login roles, но не выдаёт им object grants; точные grants должны появиться вместе со схемами FP-03/DP/LM, поэтому сами роли ещё не означают готовое соединение adapter. В Neon hostname с `-pooler` обозначает pooled URL; direct нужен там, где важны session advisory lock и migration session. [Connect to Neon](https://neon.com/docs/get-started/connect-neon), [manage computes](https://neon.com/docs/manage/endpoints/).
4. App runtime не требует `NEON_API_KEY`: это control-plane API credential для управления Neon account/project, не пароль приложения. SQL connection URLs выдаются для отдельных PostgreSQL login roles. Если когда-нибудь будет автоматизироваться provisioning, Neon поддерживает project-level permissions; это не требуется для данного app target. [Neon organization/project permissions](https://neon.com/blog/neon-now-has-per-project-permissions).

**Квота / дата:** официальный пост Neon от 2 октября 2026 сообщает Free: до 100 проектов; 100 CU-hours на проект в месяц; 1 GB Postgres storage на проект; 10 веток; autoscale максимум до 2 CU. Из-за свежего изменения всё равно записать план, регион, ветки и отображаемый usage конкретного проекта сразу после регистрации. Возможности paid plan, превышение лимитов и стоимость проверить на экране account billing до изменения тарифа. [Free plan update (2026-10-02)](https://neon.com/blog/neon-free-plan-1-gb-per-project).

### Brevo Contacts API

1. Создать/выбрать dev account и отдельный list, например `PkgCompass requests — development`. Если в account уже есть сторонние контакты/campaigns, проще и безопаснее держать dev в отдельном account, если это разрешает текущий account limit/plan. Отдельный list сам по себе не даёт изоляцию credentials.
2. Завести ровно три custom contact attributes: `PKG_SCENARIO` (text), `PKG_CONTACT_PERMISSION_AT` (text, ISO), `PKG_REQUESTED_AT` (date), как требует [spec 09](../09-lead-form.md). API adapter добавляет/обновляет контакт только в `BREVO_REQUEST_LIST_ID`; `updateEnabled = true`. В PkgCompass email — идентификатор контакта: передавать его в create-contact payload (Brevo допускает альтернативные `SMS`/`ext_id`, но этот контракт их не использует). Не отправлять email-письма, не настраивать sender, не запускать CRM automation, не назначать list campaign defaults и не создавать campaign. `I agree to be contacted about this request` — согласие только по конкретной заявке; оно не включает marketing/newsletter permission. При upsert не сбрасывать существующий unsubscribe/blocklist state. [Create contact](https://developers.brevo.com/reference/create-contact), [contact lists](https://developers.brevo.com/docs/synchronise-contact-lists).
3. Создать отдельный API key с понятным названием и датой истечения. Ключ виден только один раз; потерянный ключ заменяется новым. Обычный Brevo API key описан как credential, авторизующий API account; не считайте его contact-list scoped. Поэтому ограничить blast radius изоляцией dev account и хранить ключ только сервером. OAuth умеет scopes `contacts:read`/`contacts:write`, но для него нужен иной auth/token-refresh контракт; не добавлять эту интеграцию в ходе provisioning без отдельного решения. [API key authentication](https://developers.brevo.com/docs/api-key-authentication), [OAuth scopes](https://developers.brevo.com/docs/oauth-scopes), [create/manage keys](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys).
4. Указать ID списка в `BREVO_REQUEST_LIST_ID`. ID — не секрет, API key — секрет. Принять только собственный тестовый email-alias владельца, который никогда не используется в production; удалить его по окончании smoke. Не использовать чужие адреса.

**Квоты / дата:** справка Brevo сейчас указывает Free до 100,000 сохранённых контактов, 200 custom attributes и 300 списков; на Free также есть лимит 300 email sends в день, который проекту не нужен, так как отправки отключены. API rate limit зависит от endpoint/account tier; response headers `x-sib-ratelimit-*` содержат фактический лимит/остаток/reset. Данные публичной справки проверены 05.10.2026, но tier и текущие лимиты владельца **unverified**. Приложение делает небольшой объём запросов; не создавать отправки ради проверки лимита. [Brevo plan quotas](https://help.brevo.com/hc/en-us/articles/9168632514066-What-are-the-different-quotas-applied-in-Brevo), [pricing plans](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [API limits](https://developers.brevo.com/docs/api-limits).

### PostHog Cloud EU

1. Создать PostHog Cloud **EU** organization/project с назначением Development; Production будет отдельным project перед release. Проверить project host после регистрации: env ожидает `https://eu.i.posthog.com` без trailing path, как в [PostHog Next.js docs](https://posthog.com/docs/libraries/next-js). EU Cloud описан как hosted in Frankfurt. Это account/service setup, не юридическое заключение о compliance.
2. В application env положить только `NEXT_PUBLIC_POSTHOG_KEY` (project token) и `NEXT_PUBLIC_POSTHOG_HOST`. PostHog явно разрешает public project token в frontend; personal key вида `phx_…` может читать/менять приватные данные и в приложение не нужен. Не создавать/не хранить personal key для runtime. [Privacy docs](https://posthog.com/docs/privacy).
3. В проекте сохранить dashboard для funnel/unique conversions после подключения SDK. До принятия consent SDK не инициализируется и не отправляет запросов; после consent оставить ровно события/поля allowlist из 10, выключить autocapture, automatic pageviews, replay, surveys и feature flags. При отзыве consent остановить capture и очистить локальное состояние по контракту 10.
4. Сверить в текущем project settings retention window. Система задаёт 90 дней; API retention endpoint возвращает account/plan-derived read-only окно. Если проект не позволяет установить 90 дней, использовать оговорённую в 10 ежемесячную очистку как отдельный проверяемый путь до release. Dashboard/retention не доказывают юридическое соответствие; не добавлять email, IP, полные URL/referrer или request credentials в события. [Events retention API](https://posthog.com/docs/api/events-retention).

**Квота / дата:** PostHog public pricing/docs сейчас рекламируют 1M analytics events/month на бесплатном уровне; account-specific billable usage и retention подтвердить в созданном EU project, они не проверялись. Для релизного измерения зафиксировать plan/retention и проверить, что usage остаётся в allowance. [Pricing](https://posthog.com/pricing), [EU hosting/privacy](https://posthog.com/docs/privacy).

### GitHub Actions и Vercel

Эти targets нужны, чтобы проверить FP-04 dispatch/preview/Cron. До создания remote нет repository-specific dispatch token, workflow ID или проверенного Actions allowance.

1. Владелец создаёт GitHub repository и включает Actions. Workflow должен содержать `workflow_dispatch` и присутствовать на default branch; он должен быть enabled. API dispatch требует fine-grained token с **Actions: write**, ограниченный ровно этим repository. Проверка workflow/status — read-only; включить/повторно включать workflow перед каждым dispatch не нужно. Если он вручную disabled, владелец включает его один раз через UI/API. Токен передаётся Vercel handler как `GITHUB_DISPATCH_TOKEN`, не в браузер и не в runner. [Dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event), [workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch).
2. В GitHub Actions завести отдельный environment `development` и давать live secrets только доверенному dispatch/job. Для обычных PR из fork secrets не передаются, но код trusted ветки может их использовать: не запускать unreviewed PR-код в job с dev secrets. Actions cost зависит от visibility: standard GitHub-hosted runners бесплатны для public repos; для private repo действует allowance плана и далее биллинг. Visibility/учётный plan пока не выбран/не проверен. [Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage), [secrets scope](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
3. Подключить GitHub repository как Vercel project. Vercel Hobby допускает только personal/non-commercial use по текущим Terms; это соответствует заявленному учебному личному некоммерческому проекту, пока фактическое использование остаётся таким. Если использование станет коммерческим, Hobby больше не подходит. Domain покупать не нужно. [Hobby](https://vercel.com/docs/plans/hobby), [Terms](https://vercel.com/legal/terms).
4. Vercel Hobby Cron допускает максимум раз в день; плановое время имеет точность до часа (может запуститься в любой момент указанного часа). Этого достаточно для контракта daily. Создать `CRON_SECRET` в project environment; Vercel отправляет `Authorization: Bearer …`. На Hobby доступен один function region; для Neon Frankfurt предпочесть Vercel `fra1`, если account/project позволяет и это подтверждено после deploy. [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [function regions](https://vercel.com/docs/project-configuration/vercel-json).
5. Системные `VERCEL_URL`/`VERCEL_BRANCH_URL` доступны в deployment; `PKGCOMPASS_TRUSTED_PREVIEW=true` — owner-controlled deployment setting, не input PR. Если dev secrets задаются как Vercel Preview env, ограничить их trusted branch-specific preview или не задавать вовсе: общие Preview secrets попадают в любой deploy, к которому применимы, и fixture guard в коде не защищает от злонамеренно изменённого кода. Production secrets — только в Production scope перед release. Любое изменение env начинает действовать на новых deployments. [Environment variables](https://vercel.com/docs/environment-variables), [system variables](https://vercel.com/docs/environment-variables/system-environment-variables).

## Полный список переменных и где брать значение

Значения в `.env.example` намеренно пустые. Таблица перечисляет владельцу, какие значения будут нужны по мере появления соответствующих adapters; наличие имени не означает, что live путь уже реализован.

| Имя | Тип | Где создать/хранить |
| --- | --- | --- |
| `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_VERSION` | Project ID/dataset/API date; не секреты | Sanity project; dev dataset строго `development`; API date фиксируется при реализации |
| `SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET` | Те же public identifiers | Совпадают с dev server target; Studio входит с личной редакторской учётной записью |
| `SANITY_PREVIEW_READ_TOKEN` | Sanity robot read token для draft preview | Vercel dev/trusted preview и `.env.local`; server-only |
| `SANITY_SEED_WRITE_TOKEN` | Sanity robot write token | Только операторская локальная среда/разрешённый apply job; server-side secret |
| `SANITY_WEBHOOK_SECRET` | Owner-generated random shared secret, не API key | Совпадающий secret в Sanity webhook и dev server environment; HMAC подпись webhook |
| `PREVIEW_SESSION_SECRET` | Owner-generated random secret | Vercel dev/trusted preview + local trusted dev; cookie/session security |
| `DATABASE_READ_URL` | Neon URI с DB role/password | Dev branch, read-only role, pooler; Vercel dev backend |
| `DATABASE_IMPORT_URL` | Neon URI с отдельной DB role/password | Dev branch, collector role, direct; GitHub Actions development environment |
| `DATABASE_LEAD_URL` | Neon URI с отдельной DB role/password | Dev branch, lead role; Vercel dev и GitHub maintenance job |
| `DATABASE_MIGRATION_URL` | Neon URI с migration owner password | Dev branch, direct; только миграции/разрешённый provisioning |
| `BREVO_API_KEY` | Provider account API key | Изолированный dev Brevo account; Vercel dev + GitHub maintenance; не в Studio/client |
| `BREVO_REQUEST_LIST_ID` | Brevo list numeric ID; не секрет | Созданный dev requests list; использовать только в dev environment |
| `LEAD_HMAC_SECRET` | Owner-generated random secret | Отдельное значение на dev и production; должно совпадать у lead API и maintenance одной среды |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project token; public identifier | Dev PostHog EU project; допустим в client bundle, но SDK стартует только после consent |
| `NEXT_PUBLIC_POSTHOG_HOST` | Public URL, не секрет | `https://eu.i.posthog.com` для EU project |
| `CRON_SECRET` | Owner-generated random secret | Vercel project server env; вызов защищённого cron handler |
| `GITHUB_DISPATCH_TOKEN` | Provider-issued GitHub fine-grained PAT | Exact repository, Actions:write, разумный expiry; хранить в Vercel server env |
| `GITHUB_API_TOKEN` | Provider-issued GitHub read credential; может быть не нужен для малого объёма public metadata | Только collector job. Если нужно, repository-scoped, read-only; не dispatch token |
| `IMPORT_INVALIDATION_SECRET` | Owner-generated random shared secret | Одинаковый dev secret в collector runner и dev invalidation handler; отдельный prod secret позже |
| `SITE_URL`, `APP_ENV`, `PRIVACY_CONTACT_EMAIL` | URL/mode/contact; не service credentials | Owner задаёт в конкретной среде; privacy contact нужен до публичной формы |
| `PKGCOMPASS_TRUSTED_PREVIEW` | Owner-controlled boolean, не секрет | Только branch-specific trusted Vercel Preview; никогда не вычислять из PR payload |

Generated secrets создавать криптографическим генератором в менеджере паролей/секретов, с отдельным значением на dev и prod. Не передавать generated secret в аргументах команд, журналы, reports, screenshot или Git. Provider tokens и DB URLs создавать после регистрации; уникальное имя ключа и expiration облегчают ротацию. Идентификаторы проекта/list/region можно безопасно записать в run report, если там нет PII.

`GITHUB_DISPATCH_TOKEN` живёт на Vercel, потому что Cron handler вызывает REST API GitHub. Secrets самих collector/maintenance jobs живут в GitHub Actions `development` environment. `CRON_SECRET` не заменяет GitHub token; `IMPORT_INVALIDATION_SECRET` и `SANITY_WEBHOOK_SECRET` имеют разные consumers и должны быть разными. Все `NEXT_PUBLIC_*` значения доступны браузерному коду. Текущий public runtime projection также раскрывает несекретное поле `environment` и PostHog project key/host (`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`); provider server tokens и DB URLs туда не попадают.

## Что сейчас реально готово

Development credentials сохранены владельцем в ignored `.env.local`; `.env.example` содержит только шаблон. В проходе 2026-10-05–06 подготовлены воспроизводимые dev CLI: Sanity anonymous published и authenticated preview aggregate reads, authentication четырёх Neon ролей, Brevo list/attributes и отдельный smoke контакта владельца через настоящий CRM adapter. Выполненные проверки и ограничения указаны в текущем run FP-04. Эти target probes отдельно не подтверждают editing flow или форму заявки; последующие table grants и runtime результаты перечислены ниже. PostHog EU settings заполнены; настоящий granted transport подтверждён EU HTTP 200. Полная проверка consent lifecycle фиксируется отдельно. Авторизованный retention API 6 октября вернул null для обоих полей: 90-дневное окно не подтверждено.

GitHub remote подключён. Ранний Next.js Preview ветки `work/foundation-first-pass` имел статус READY; последний перед продолжением 7 октября deployment упал из-за отсутствующего `NEXT_PUBLIC_POSTHOG_KEY`. 7 октября разрешённые runtime credentials перенесены только в branch Preview через stdin; новая сборка `dpl_GzmC9JXvZX4DLXeTqgnSd2LnDr98` получила READY, authenticated `/api/catalog-status/` подтвердил development/available. Preview защищён Vercel Authentication; для GitHub collector invalidation нужен отдельный согласованный authenticated dev path. Function region сейчас `iad1`; выбор региона нужно согласовать до live data flows.

Bootstrap поддерживает PostgreSQL 16+ ADMIN-only membership создателя роли и ограниченного администратора Neon. Новые SQL-роли создаются без паролей: сначала задать пароль через административное SQL-соединение и сохранить его только в secret store; Reset password в кабинете может не работать до первоначального назначения. Для migration owner временное SET ROLE разрешение снимается после настройки default privileges. Выполнять весь bootstrap в одной транзакции, обычным Run, без Explain и без выделения части DO-блока.

Live selection в `src/server/config/targets.ts` валидирует настройки, включая запрет personal PostHog key в публичной конфигурации; connection factories и migration runner подготовлены. CRM adapter и Sanity read smoke подготовлены; четыре доменные migrations и точные grants применены на dev Neon, повтор миграций и четыре положительных/запрещённых role probes прошли. Runtime consumers и полная приёмка соответствующих CW/DP/LM задач учитываются отдельно. Generated secrets настроены локально; GitHub dispatch token пока не заполнен. Vercel Cron автоматически запускается только для Production; Preview dev smoke будущего защищённого handler выполняется вручную. Полный FP-04 остаётся незавершённым до сквозных live smoke и настройки dispatch credential. Проверяемое удаление analytics старше 90 дней требуется до production по spec 10; наблюдение null не подменяет эту проверку. Account quotas в этом проходе проверены отдельно через UI; динамический usage не является бессрочной гарантией бесплатности.

## Результат прохода 6 октября

На development опубликован точный набор из 28 synthetic документов для пяти CMS и одной пары; повторный publisher не создаёт записей. Локальные authenticated preview, draft isolation и signed webhook проверены. Sanity запрещает anonymous read документов с точкой в `_id`; нормативные localized/page/settings IDs исправлены на root IDs с `_`. Старые 11 dotted canonical документов и 11 drafts сохранены; приложение их не использует, удаление не выполнялось.

Collector реально прочитал npm/GitHub и дважды обновил 20 current metrics в dev Neon; invalidation завершилась успешно. В CLI environment выбирается явно. Пример последовательности (RUN_ID — текущий run из worklog):

```sh
APP_ENV=development SITE_URL=http://127.0.0.1:3000 npm run dev -- --hostname 127.0.0.1
APP_ENV=development SITE_URL=http://127.0.0.1:3000 npm run collect -- --env development --dry-run --report-path "artifacts/runs/$RUN_ID/evidence/collector-dry-run.json"
APP_ENV=development SITE_URL=http://127.0.0.1:3000 npm run collect -- --env development --apply --report-path "artifacts/runs/$RUN_ID/evidence/collector-apply.json"
APP_ENV=development SITE_URL=http://127.0.0.1:3000 node scripts/dev/measurement-browser-smoke.mjs --env=development --offline-fixture
```

Последняя команда использует локальный браузер с перехватом всех внешних запросов; её pass подтверждает fixture transport, а не ingestion PostHog. Live Brevo API формы и полный PostHog funnel не запускались после отклонения automatic approval review; для повторного запуска требуется явное разрешение владельца на точные внешние действия. Исторический Brevo adapter upsert/cleanup и частичный PostHog EU HTTP200 не заменяют эти проверки.

`.github/workflows/daily.yml` подготовлен для ручного development dispatch. На default branch он отсутствует, `GITHUB_DISPATCH_TOKEN` не заполнен, поэтому реальный dispatch — `not_run`. Активный Vercel Cron не добавлен; его безопасное предложение сохранено в локальном evidence. Publication остаётся отдельным действием владельца. Подробная матрица и следующий шаг — в [итоге FP-04](../work/journal/2026-10-06-fp04-review.md).

## Продолжение 7 октября

Владелец разрешил точный dev smoke формы/Brevo и очистку собственных данных. Проверка локального `/api/leads/` прошла: accepted, стабильный retry, dedup отдельного запроса, hash-only SQL row и удаление только созданного контакта/собственных SQL записей. Письма и campaigns не используются. Исторический отказ automatic approval review сохраняется как `not_run`; успешный разрешённый повтор записан отдельно.

По отдельному разрешению опубликован main bootstrap `8f245f3`: только `.github/workflows/daily.yml` и `vercel.json` с `git.deploymentEnabled.main=false`. Это постоянная пауза автодеплоя main до разрешённого release change; существующий production остаётся на `e17fdb0`. Workflow уже `active`, дополнительный enable API call не требуется. GitHub environment `development` получил только `DATABASE_IMPORT_URL`, `IMPORT_INVALIDATION_SECRET` и публичные Sanity variables; `SITE_URL` задаётся после READY Preview. Отдельный fine-grained `GITHUB_DISPATCH_TOKEN` создаёт владелец; owner CLI credential приложению не передаётся.

Для PostHog подготовлен `dev:check:posthog-live`: строгий dev/EU/project scope, явный opt-in и четыре synthetic события через общий runtime sanitizer. Personal API key отклоняется до сети. Public token сверён с авторизованными настройками dev project `295214` без сохранения значения. Fixture `lead_accepted` использует отдельный synthetic conversionId; он не доказывает реальную CRM-конверсию. HTTP transport и dashboard ingestion учитываются отдельно; provider может создать synthetic profile. Независимый review и семь fixture tests прошли. Live EU transport принял четыре события; авторизованный Activity UI подтвердил четыре строки, по одному каждого типа, с одним synthetic identifier. Значения идентификаторов/payload не сохранялись.

Оставшийся dispatch smoke требует отдельного fine-grained token и согласования временного dev OIDC для защищённого Preview. Патч ограничивает OIDC точным Preview alias и рабочей веткой, выдаёт его только шагу collector; GitHub Environment branch policy ещё предстоит применить. По [OIDC reference](https://vercel.com/docs/oidc/reference) development token действует 12 часов; после одного run временный GH secret удаляется. Это не постоянная CI-конфигурация. Актуальные входы, независимое review и незавершённая очистка ошибочного CLI probe — в [отчёте 7 октября](../work/journal/2026-10-07-fp04-unblock.md).

## Официальные источники по квотам

### Проверенные параметры аккаунтов

Read-only проверка авторизованных экранов выполнена 2026-10-05. Очищенное evidence хранится в run `20261005T213908Z-FP-04-5e2c90d6`; сырые DOM, screenshots с данными аккаунта и credentials не сохранялись. Usage counters могут обновляться с задержкой.

| Аккаунт / target | Подтверждено через UI | Осталось |
| --- | --- | --- |
| Sanity `qrv3qhw1` | Growth Trial $0, 30 дней до автоматического Free; development и production public, 2/2 datasets; 1/2 webhooks; 0/10k documents; API 3/250k, CDN 0/1m, bandwidth 632 B/100 GB | Не использовать trial-only permissions/private features как основу Free v1. Residency, preview/publisher/webhook runtime — отдельные проверки |
| Neon PkgCompass | Free $0/month, Frankfurt `eu-central-1`; development отмечена Schema-only; 2 ветки. На проект: 1 GB, 100 compute hours, 10 branches, autoscale 2 CU | Live проход 6 октября подтвердил migrations apply/repeat и четыре SQL role probes; итоговая повторная приёмка фиксируется в FP-04 |
| Brevo | Free; 300 sends remaining; экраны Campaigns и Automations пустые | Отправки не используются; API smoke и retention проверяются отдельно |
| PostHog project `295214` | PkgCompass development, EU application; allowance и billing limit 1M events; discard client IP включён. 6 октября авторизованный read-only retention API вернул `retention_months: null`, `retained_from: null` | По [контракту API](https://posthog.com/docs/api/events-retention) plan-derived window отсутствует. Это не 90-дневная retention; проверяемый путь удаления остаётся открытым. Consent-only SDK и dashboard smoke фиксируются отдельно |
| Vercel pkg-compass | Hobby; Next.js Preview READY; production main пока содержит документацию; fast transfer 551.82 kB/100 GB в отображаемом периоде Sep 5–Oct 5 | Runtime Preview, Cron/dispatch требуют handlers/workflow. Регион функции `iad1` пока не изменён |
| GitHub stupidkubik/stack-atlas | Public; Actions доступен, показывает каталог первоначальной настройки workflows | `daily` отсутствует на default branch; dispatch not_run. Платные runners/features не выбирались; расходов/upgrade не выполняли |

Страницы тарифов меняются. Для отчёта FP-04 фиксировать дату просмотра и account-specific Plan/Usage page, не считать нижеследующие публичные значения подтверждением персонального аккаунта.

| Сервис | Документированный срез на 2026-10-05 | Что проверить в owner account |
| --- | --- | --- |
| Sanity | Free: 2 public-only datasets; ресурсы помесячно UTC, hard caps могут блокировать API/CDN | Project Plan/Usage quotas, использование документов/assets/API/CDN/bandwidth; нет ли trial/private features |
| Neon | Free update 2026-10-02: 100 projects, 100 CU-hours/project/month, 1 GB/project, 10 branches, autoscale up to 2 CU | Plan, доступность Frankfurt и schema-only branch, фактическое storage/compute/branch usage, billing state |
| Brevo | Free docs: 100k contacts, 200 contact attributes, 300 lists, 300 email sends/day; endpoint/account API limits см. заголовки | Account plan, контакты/атрибуты/lists и текущие API limit headers; отправки остаются отключены |
| PostHog | Public pricing/docs: 1M events/month on free tier, event retention 1 year; [retention API](https://posthog.com/docs/api/events-retention) read-only и определяется plan | Фактическое account window и возможность 90 дней; при недоступности — ежемесячная очистка по spec 10 до release |
| Vercel | Hobby: personal/non-commercial; cron at most daily, ±59 min; one selected function region | Eligibility/use, Cron enabled, function region, monthly included resource usage |
| GitHub Actions | Standard hosted runner minutes free for public repos; private repos use plan allowance then billable | Repository visibility, account plan, billing budget/usage and workflow availability |
