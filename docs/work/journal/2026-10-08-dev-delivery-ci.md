# Постоянный development webhook и fixture CI

Дата: 8 октября 2026. Run `20261008T211710Z-QA-01-d31ad8f6`. Владелец отдельно разрешил постоянный Automation Bypass, передаваемый только в header development webhook Sanity; затем отдельно разрешил публикацию трёх FP-05 commits и manual fixture workflow в рабочей ветке, регистрацию только workflow в main и удалённый запуск. Production release не выполняется.

## Постоянная доставка: pass

Sanity project `qrv3qhw1`, dataset `development`, webhook `PoXfyc7eNszUbbkT` теперь включён и направлен на постоянный branch alias:

`https://pkg-compass-git-work-foundati-aea6dd-evgeniis-projects-0daccd9a.vercel.app/api/revalidate/`

Vercel project `pkg-compass` получил отдельный bypass с note `Sanity development webhook (permanent)`, `isEnvVar=false`. Значение передано только через `x-vercel-protection-bypass` в Sanity webhook; в source, local env, URL, evidence и чат оно не записывалось. Существующий bypass сохранён. Этот credential технически действует на все deployments проекта — ограничение [Automation Bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), явно принятое владельцем; защита проекта не выключалась.

Пятиключевая `rule.projection`, development-only dataset, исключение drafts/versions и прежний signing secret сохранены. Дополнительный header не заменяет подпись: запрос с bypass без подписи вернул401, корректно подписанный запрос200. Catalog status на alias —200/development; без bypass —302. Настройка header и projection соответствует [Webhooks API](https://www.sanity.io/docs/http-reference/webhooks).

Настоящая automatic Sanity доставка проверена созданием одного собственного synthetic redirect: результат200 за4.9s, одна попытка. Документ удалён только после сравнения полного логического тела и revision guard, отсутствие подтверждено. Существующий editorial content не менялся. Последующее чтение подтвердило прежние project protection, existing bypass и production deployment. Evidence: [dev-delivery-result.json](../../../artifacts/runs/20261008T211710Z-QA-01-d31ad8f6/evidence/dev-delivery-result.json).

Первая немедленная проверка после создания bypass не прошла. Попытка cleanup без `regenerate:false` не завершила revoke; это зафиксировано как fail, а не pass. Read-only диагностика подтвердила200/development с тем же новым named bypass на alias и immutable deployment. Продолжение использовало этот же секрет; дополнительных секретов не создано. Итоговая успешная проверка хранится отдельно от первой неуспешной.

Для эксплуатации сохранять рабочую ветку и branch alias; новые Preview из этой ветки должны иметь тот же development config и signing secret. При смене ветки/проекта сначала подготовить новую delivery target и проверить подпись/automatic200. Для отзыва найти точный note в Vercel Settings → Deployment Protection → Protection Bypass for Automation, выключить dev hook, удалить его header и отозвать только этот bypass. Не переносить credential в client config или query string. Полный Studio CORS/редакторский walkthrough этой настройкой не заявляется.

## Удалённый fixture CI

Рабочая ветка опубликована на `182d87b`: три проверенных FP-05 commits и новый [fixture-browser.yml](../../../.github/workflows/fixture-browser.yml). В main создан `fcb525c`: изменён ровно один файл workflow; `vercel.json` с `deploymentEnabled.main=false` сохранён. Manual dispatch требует регистрации workflow на default branch ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)).

[Run 37846708506](https://github.com/stupidkubik/stack-atlas/actions/runs/37846708506) на точном source `182d87bab9e2813db3c22a36efc8561911748063` завершился **success**: npm ci, lint, typecheck,295 unit tests passed/13 live-gated skipped и2 browser tests passed за11.2s. Counts сверены с logs в памяти; raw logs в local evidence не сохранены. Это настоящий remote run, локальный CI-mode не переименован в remote pass. Очищенный результат: [remote-ci-result.json](../../../artifacts/runs/20261008T211710Z-QA-01-d31ad8f6/evidence/remote-ci-result.json).

Push рабочей ветки создал dev Preview `dpl_Hn3LwWdchcbuz4bfARfkAKvmrxou`, **READY**, source `182d87b`. Branch alias автоматически переключился на него. После redeploy повторно проверены200/development,401без подписи и200с подписью; настоящая Sanity delivery200 за4.752s и CAS cleanup второго собственного synthetic redirect. Дополнительный bypass не создавался, hook URL/header сохранены. Evidence: [post-redeploy-result.json](../../../artifacts/runs/20261008T211710Z-QA-01-d31ad8f6/evidence/post-redeploy-result.json).

Job имеет только `contents: read`, manual-only event и guard точной рабочей ветки. Live environment/secrets не подключены. Последовательность: pinned Node/npm → npm ci → lint/typecheck/unit tests → Chromium → isolated fixture browser path. Traces/screenshots/video отключены; raw browser output не загружается как artifacts. Public repo и standard hosted runner подтверждены перед запуском; paid runners/upgrades не выбирались.

Это узкий CI-пункт прототипа, а не полный DoD QA-01: clean production build, реальная DB/role integration matrix, HTTP/axe и общая Q-evidence система остаются отдельным доведением. FP-03 и LM-08 не повышаются автоматически только из-за настройки доставки или создания workflow.

Запрошенная настройка завершена. Run QA-01 закрыт `planned`, поскольку полный объём QA-01 ещё предстоит; это не отказ выполненной настройки. Финальная проверка279files: значение нового bypass отсутствует в repository/local env/run evidence, webhook остаётся enabled. Результат — [final-safety-result.json](../../../artifacts/runs/20261008T211710Z-QA-01-d31ad8f6/evidence/final-safety-result.json). Документация обновлена локально отдельно от согласованной публикации workflow.
