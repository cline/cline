# Vendored Dify provider

Source: [dify-ai-provider](https://github.com/warmwind/dify-ai-provider) v1.1.1,
commit `352943be697b89cf1a4d329e11b53c1f19e4286d`, MIT, (c) 2024 Oscar Jiang
([LICENSE](./LICENSE)).

## Why it is vendored

The published package depends on `@ai-sdk/provider-utils@^3`, which depends on
`undici@^5.29.0`. 5.29.0 is the last 5.x release and has no fix for
CVE-2026-1525 or the other 5.x advisories. The root `undici` override fixes
this for our own builds only. It does not travel with the published
`@cline/llms`, so `npm install cline` or `npm install @cline/llms` still
installed undici 5.29.0. The upstream package was last published in June 2026
and has no release on `provider-utils` 4 or 5.

Vendoring compiles the provider against the `@ai-sdk/provider-utils` 5 and
`zod` 4 that `@cline/llms` already depends on, so no new package enters the
install.

## Changes from upstream

- `dify-chat-schema.ts`: `z.record(z.unknown())` becomes
  `z.record(z.string(), z.unknown())` (zod 4 requires the key schema).
- `stream-parser.ts`: the function-tool filter uses
  `LanguageModelV2FunctionTool` instead of an inline type that no longer narrows
  the tool union, and file uploads wrap the bytes in a `Uint8Array` for
  `BlobPart`.
- `dify-chat-language-model.test.ts`: blocking-mode fixtures return real
  `Response` objects. provider-utils 5 reads bodies through a size-limited
  stream reader, not the `text()` stub the fixtures used.
- `index.ts` re-exports `dify-provider.ts`, as upstream's does.
- `dify-provider.ts`: the `fetch` option is passed to the model. Upstream
  declared it but dropped it, so `@cline/llms` passing `config.fetch` (proxy
  and sticky-session wrappers) had no effect and Dify always used the global
  `fetch`. `wire.test.ts` covers this.

Behaviour is otherwise unchanged. Upstream's model and stream-parser tests are
copied alongside and pass unmodified apart from the fixture change above.
`vendored.test.ts` keeps `dify-ai-provider` out of the dependency list.
