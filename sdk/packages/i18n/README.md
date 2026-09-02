# @cline/i18n

Shared localization runtime and message catalogs for Cline apps (VS Code webview, extension host, and — eventually — the CLI and desktop app).

- **Runtime:** a thin factory over [i18next](https://www.i18next.com). `createI18nInstance(locale)` returns a fully-initialized, isolated instance with every catalog bundled. React frontends pair it with `react-i18next`; non-React hosts call `instance.t()` directly.
- **Catalogs:** plain JSON under `src/locales/<locale>/<namespace>.json`. English (`en`) is the source of truth; every other locale must mirror its key set (enforced by `tests/catalogs.test.ts`, modulo CLDR plural suffixes like `_one`/`_few`/`_other`).
- **Namespaces:** `common` (shared verbs/labels), `history`, `settings`, `notifications` (extension-host messages). Add a namespace by creating the file in each locale and registering it in `src/resources.ts`.

## Adding a language

1. From this package: `bun run translate -- --lang <bcp47>` (e.g. `ja`, `pt-BR`). It creates `src/locales/<lang>/`, fills every namespace from English via Claude, and regenerates `src/resources.ts` so the locale (and its display name) is registered automatically. Or author the JSON by hand and run `bun run translate -- --regen`.
2. Review the diff, then `bun run test` — catalog parity is enforced.

Other maintenance commands: `bun run translate` fills gaps in every registered locale; `-- --check` reports missing keys without calling the API (CI-friendly, exits 1); `-- --lang es --retranslate <keyPrefix>` re-translates keys after their English copy changed.

## Key conventions

- Semantic, camelCase, dot-nested: `history.filters.newest`, not English-as-key.
- Interpolation uses i18next syntax: `"Delete {{count}} Selected"`.
- Plurals use CLDR suffixes (`deleteSelected_one`, `deleteSelected_other`, …). Provide exactly the categories the target language uses (zh/ko: `_other` only; ru: `_one`/`_few`/`_many`/`_other`).
- Aria-label variants get an `Aria` suffix (`deleteAllAria`) when they differ from the visible string.
