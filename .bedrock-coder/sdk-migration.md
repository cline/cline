# SDK Adapter

The VSCode extension runs on the BedrockCoder SDK (`@bedrock-coder/core`, `@bedrock-coder/llms`,
`@bedrock-coder/shared`) through an adapter layer in `apps/vscode/src/sdk/`. The
webview still talks gRPC; the adapter translates between gRPC handlers and SDK
calls. See `apps/vscode/src/dev/debug-harness/README.md` for the debug harness.

## Conventions

1. **Look up SDK APIs, don't guess.** Use `kb_search(name="sdk", query="...")`
   before implementing against an SDK surface.
2. **Reference the pre-SDK implementation when replacing a module.** Add a
   `// Replaces classic src/core/... (see origin/main)` header and use
   `kb_search(name="bedrockCoder", commit="origin/main")` or
   `git show origin/main:path` to consult the prior implementation.
3. **Single entry point.** There is one codepath — the SDK adapter. No
   `BEDROCK_CODER_SDK` env flag.
4. **Use the configured `{appBaseUrl}`**; never hardcode a hosted product endpoint.
5. **Avoid `as` casts.** Use explicit conversion functions with tests. The
   branded types in `apps/vscode/src/sdk/model-catalog/contracts.ts` exist so
   casts are unnecessary outside parse/compute boundaries.

## Debug harness

- **Dismiss the Kanban/promo overlay** before any debug harness interaction.
- **Use the command palette** to navigate tabs in the debug harness.
