---
name: cline-extension
description: Navigate and modify the Cline VS Code extension codebase. Use when working on controllers, task runner, webview UI, state management, tool handlers, system prompts, or message types. Triggers on "Controller", "TaskState", "webview", "ClineAsk", "ClineSay", "ExtensionMessage", "system prompt".
---

# Cline Extension Development

Cline is a VS Code extension with TypeScript backend and React webview, communicating via gRPC-over-postMessage.

## Directory Map

| Path | Purpose |
|------|---------|
| `src/core/controller/` | Request handlers, state management |
| `src/core/task/` | Task execution loop |
| `src/core/prompts/system-prompt/` | Model-specific prompts |
| `src/shared/` | Types shared with webview |
| `src/integrations/` | Terminal, git, browser |
| `webview-ui/src/` | React frontend |

## Quick Patterns

### Add ClineAsk/ClineSay Type

1. **Type**: `src/shared/ExtensionMessage.ts`
2. **Proto enum**: `proto/cline/ui.proto`
3. **Conversion**: `src/shared/proto-conversions/cline-message.ts`
4. **Run**: `npm run protos`
5. **UI**: `webview-ui/src/components/chat/ChatRow.tsx`

### Add Global State

1. **Schema**: `src/shared/storage/state-keys.ts`
2. **Reader**: `src/core/storage/utils/state-helpers.ts`
3. **Run**: `npm run protos`

### Add Tool

1. **Enum**: `src/shared/tools.ts`
2. **Spec**: `src/core/prompts/system-prompt/tools/{name}.ts`
3. **Register**: `src/core/prompts/system-prompt/tools/init.ts`
4. **Variants**: Add to each `variants/*/config.ts`
5. **Handler**: `src/core/task/tools/handlers/`

See [references/patterns.md](references/patterns.md) for detailed examples.

## Common Commands

```bash
# Build and watch
npm run watch

# Run tests
npm run test:unit

# Update prompt snapshots
UPDATE_SNAPSHOTS=true npm run test:unit

# Regenerate protos
npm run protos

# Lint
npm run lint
```

## Key Files

| File | When to modify |
|------|----------------|
| `src/shared/ExtensionMessage.ts` | Adding message types |
| `src/shared/storage/state-keys.ts` | Adding settings/state |
| `src/core/controller/index.ts` | Wiring new services |
| `src/core/task/index.ts` | Modifying execution loop |
| `src/core/task/TaskState.ts` | Adding task state fields |

## Gotchas

- **Proto regeneration required** after changing `state-keys.ts` or `.proto` files
- **Snapshot updates required** after changing prompts
- **StateManager cache** - some startup state bypasses cache (see `.clinerules/general.md`)

## Additional Resources

- [references/patterns.md](references/patterns.md) - Detailed code patterns
- [references/file-map.md](references/file-map.md) - Complete directory structure
- `.clinerules/general.md` - Codebase conventions
