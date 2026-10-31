# @cline/i18n

Shared, framework-agnostic i18n runtime for Cline apps: locale catalogs,
`{name}` interpolation, `{count, plural, …}` plurals (via `Intl.PluralRules`),
and locale-aware `Intl` formatting — plus an optional React binding.

Zero runtime dependencies. `react` is an optional peer (only `@cline/i18n/react`
needs it).

## Exports

| Entry | Contents |
| --- | --- |
| `@cline/i18n` | `createTranslator`, `resolveLocale`, `normalizeTag`, `DEFAULT_LOCALE`, `interpolate`, `extractPlaceholders`, types |
| `@cline/i18n/react` | `I18nProvider`, `createI18nStore`, `useTranslation`, `useLocale`, `buildTranslator` |
| `@cline/i18n/locales/en.json` | English catalog (source of truth for keys) |
| `@cline/i18n/locales/zh-Hans.json` | Simplified Chinese catalog |

## Message format

- Interpolation: `"{command}"`, `"Currently using {languageName}"`.
- Plurals: `"{count, plural, one {# session running} other {# sessions running}}"`
  — `#` renders the locale-formatted count; the branch is chosen by
  `Intl.PluralRules` for the active locale. Chinese only needs `other`.
- Values are inserted verbatim; translations must not contain HTML.

## Keys

Flat dotted keys scoped by area, e.g.
`settings.general.language.title`, `chat.composer.placeholder`,
`native.tray.newSession`, `notifications.task.finished.body`,
`errors.<domain>.<code>`.

## Adding a translation

1. Add the key to `locales/en.json` (the source of truth) **and** to every
   other catalog.
2. Run `bun run i18n:types` (regenerates `src/generated/message-keys.ts`).
3. Run `bun run i18n:check` — it fails on missing/extra keys, placeholder
   mismatches, empty values, unbalanced braces, HTML in translations, and
   untranslated (English-identical) entries.

## Adding a language

1. Create `locales/<tag>.json` mirroring `en.json`'s key set (tag in BCP-47
   form, e.g. `zh-Hant`, `ja`).
2. Register the tag in the host app's available-locale list
   (`webview/lib/locale.ts` for the desktop app) and, if it needs native menu
   strings, in the native labels table.
3. `zh-Hant` automatically falls back to `zh-Hans` when no Traditional catalog
   ships.

## Testing

```bash
bun run test        # vitest
bun run i18n:check  # catalog gate
bun run build       # tsc -> dist
```
