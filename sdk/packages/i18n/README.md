# @cline/i18n

Shared localization runtime and message catalogs for Cline apps (VS Code webview, extension host, and — eventually — the CLI and desktop app).

- **Runtime:** a thin factory over [i18next](https://www.i18next.com). `createI18nInstance(locale)` returns a fully-initialized, isolated instance with every catalog bundled. React frontends pair it with `react-i18next`; non-React hosts call `instance.t()` directly.
- **Catalogs:** plain JSON under `src/locales/<locale>/<namespace>.json`. English (`en`) is the source of truth; every other locale must mirror its key set (enforced by `tests/catalogs.test.ts`, modulo CLDR plural suffixes like `_one`/`_few`/`_other`).
- **Namespaces:** one JSON file per UI area under each locale (`chat`, `settings`, `providers`, `mcp`, `notifications` for extension-host messages, `common` for shared verbs, …). `src/resources.ts` is **generated** — never edit it; a new namespace is just a new `en/<name>.json` plus `bun run translate -- --regen`.

## Adding new strings

1. Add the English key to the right `src/locales/en/<namespace>.json`.
2. Reference it in code:
   - **Webview component:** `const { t } = useTranslation()` → `t("chat:some.key")`; text with embedded links/elements → `<Trans i18nKey="...">` from react-i18next.
   - **Non-component webview module:** `import { i18n } from "@/i18n"` and call `i18n.t(...)` inside the function (never at module top level — the locale isn't resolved yet at import time).
   - **Extension host:** `import { t } from "@/services/i18n"` → `t("some.key")` (defaults to the `notifications` namespace; prefix `"common:..."` etc. to override).
3. Translate: `bun run translate` fills the missing keys in every locale via Claude (needs `ANTHROPIC_API_KEY` or an `ant auth login` profile), or author the translations by hand.
4. `bun run test` — key parity across locales is enforced.

## Adding a language

1. From this package: `bun run translate -- --lang <bcp47>` (e.g. `ja`, `pt-BR`). It creates `src/locales/<lang>/`, fills every namespace from English via Claude, and regenerates `src/resources.ts` so the locale (and its display name) is registered automatically. Or author the JSON by hand and run `bun run translate -- --regen`.
2. Review the diff, then `bun run test` — catalog parity is enforced. The language appears in the extension's Display Language picker automatically (`SUPPORTED_LOCALES` derives from the generated `resources.ts`).
3. The one manual step: `apps/vscode/package.nls.<locale>.json` (lowercase locale, e.g. `package.nls.ja.json`) — the ~32 command-title/walkthrough strings VS Code itself renders. Copy `package.nls.json` and translate it.

Other maintenance commands: `bun run translate` fills gaps in every registered locale; `-- --check` reports missing keys without calling the API (CI-friendly, exits 1); `-- --lang es --retranslate <keyPrefix>` re-translates keys after their English copy changed.

## Key conventions

- Semantic, camelCase, dot-nested: `history.filters.newest`, not English-as-key.
- Interpolation uses i18next syntax: `"Delete {{count}} Selected"`.
- Plurals use CLDR suffixes (`deleteSelected_one`, `deleteSelected_other`, …). Provide exactly the categories the target language uses (zh/ko: `_other` only; ru: `_one`/`_few`/`_many`/`_other`).
- Aria-label variants get an `Aria` suffix (`deleteAllAria`) when they differ from the visible string.
