# 2026-09-07 — удалён pnpm-lock.yaml (beads-web-i0d)

В репозитории лежали два файла блокировки зависимостей: `package-lock.json` и
`pnpm-lock.yaml`. Второй достался от исходного проекта (добавлен 2026-01-21,
до расхождения форка) и с тех пор ни на что не влиял: `release.yml` и
`quality.yml` ставят зависимости через `npm ci`, `flake.nix` — через
`npmDepsHash`, проверка на дрейф в `ci.yml` перечисляет только `flake.lock`,
`package-lock.json` и `server/Cargo.lock`, поле `packageManager` в
`package.json` не задано.

**Почему удалили, а не оставили «на всякий случай».** Любая команда, которая
дотягивается до pnpm, переставляет `node_modules` на раскладку pnpm, уносит
установленные через npm пакеты в `node_modules/.ignored` и переписывает
`pnpm-lock.yaml` примерно на 1650 строк. Возврат — только через `npm install`.
Наступили на это в этой же сессии.

**Что проверить, если сломается.** `npm ci` падает — сверить `package-lock.json`
с `package.json` (версии там уже расходились, починено в 75f5256). Появился
чужой файл блокировки — его теперь ловит `.gitignore`, где закрыты
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock` и `bun.lockb`.

**Что намеренно не трогали.** Поле `packageManager` в `package.json` не
добавляли — оно включает corepack и меняет поведение на машинах разработчиков;
для запрета хватило `.gitignore`.
