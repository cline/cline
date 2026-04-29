# TypeScript LSP Plugin

A plugin that gives the agent a `goto_definition` tool powered by the TypeScript Language Service API. Instead of grep or text search, it resolves symbols through imports, re-exports, type aliases, and declaration merging -- the same way your IDE does.

Code entrypoint: [index.ts](./index.ts)

## What it does

The agent gets a single tool: `goto_definition(file, line)`. It finds all identifiers on that line and resolves where they're actually defined. For example, given an import line like:

```ts
import { disposeAll, initVcr } from "@clinebot/shared"
```

It resolves both symbols through the workspace package alias to their source files:

```
disposeAll -> packages/shared/src/dispose.ts:19
initVcr    -> packages/shared/src/vcr.ts:699
```

## Why this matters

This is a good example of the kind of plugin that makes agents dramatically more effective at navigating large codebases. Text search can find symbol names but can't distinguish between definitions, references, re-exports, and shadowed variables. The TypeScript Language Service handles all of that.

The same pattern applies for enterprise use cases: you can build plugins that wrap internal APIs, deployment systems, feature flags, incident management, CI pipelines, or anything else your team works with. A plugin is just a TypeScript file -- no MCP server to host and maintain.

## Use it with the CLI

```bash
cp apps/examples/plugin-examples/typescript-lsp-plugin/index.ts ~/.cline/plugins/typescript-lsp.ts
clite -i "Find where createTool is defined"
```

The plugin resolves `typescript` from the target project's own `node_modules` at runtime, so it uses the same TS version the project compiles with. No extra dependencies needed.

## Run the demo directly

```bash
ANTHROPIC_API_KEY=sk-... bun run apps/examples/plugin-examples/typescript-lsp-plugin/index.ts
```

## How it works

The plugin registers a single tool via `createTool()` in its `setup()` method:

```ts
const plugin: AgentExtension = {
  name: "typescript-lsp",
  manifest: {
    capabilities: ["tools"],
  },

  setup(api) {
    api.registerTool(
      createTool({
        name: "goto_definition",
        description: "Find where TypeScript/JavaScript symbols on a given line are defined...",
        inputSchema: {
          type: "object",
          properties: {
            file: { type: "string", description: "Absolute path to the file." },
            line: { type: "integer", description: "Line number (1-based)." },
          },
          required: ["file", "line"],
        },
        async execute(input) {
          // 1. Walk up from the file to find tsconfig.json
          // 2. Create (or reuse cached) TypeScript Language Service
          // 3. Scan the AST for identifiers on the target line
          // 4. Resolve each identifier's definition via the Language Service
          // 5. Filter out self-references and return locations
        },
      }),
    );
  },
};
```

Under the hood:

1. `findTsConfig()` walks up parent directories from the target file to find the nearest `tsconfig.json`
2. `loadTypeScript()` uses `createRequire()` to resolve `typescript` from the project's own `node_modules`
3. `createLanguageService()` sets up a full TypeScript Language Service with the project's compiler options
4. The service is cached so subsequent calls in the same session reuse it
5. `getIdentifierOffsetsOnLine()` scans the AST to find all identifiers on the requested line
6. Each identifier is resolved via `service.getDefinitionAtPosition()`, which follows through imports, re-exports, type aliases, etc.

Then pass it to the SDK:

```ts
const host = await ClineCore.create({});
await host.start({
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    cwd: process.cwd(),
    enableTools: true,
    systemPrompt: "You are a helpful assistant.",
    extensions: [plugin],
  },
  prompt: "Find where createTool is defined",
  interactive: false,
});
```
