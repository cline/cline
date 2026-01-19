This file is the secret sauce for working effectively in this codebase. It captures tribal knowledge—the nuanced, non-obvious patterns that make the difference between a quick fix and hours of back-and-forth & human intervention.

**When to add to this file:**
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to "add this to CLAUDE.md"

**Proactively suggest additions** when any of the above happen—don't wait to be asked.

**What NOT to add:** Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

## Miscellaneous
- This is a VS Code extension—check `package.json` for available scripts before trying to verify builds (e.g., `npm run compile`, not `npm run build`).
- When creating PRs, if the change is user-facing and significant enough to warrant a changelog entry, run `npm run changeset` and create a patch changeset. Never create minor or major version bumps. Skip changesets for trivial fixes, internal refactors, or minor UI tweaks that users wouldn't notice.
- When adding new feature flags, see this PR as a reference https://github.com/cline/cline/pull/7566

## gRPC/Protobuf Communication
The extension and webview communicate via gRPC-like protocol over VS Code message passing.

**Proto files live in `proto/`** (e.g., `proto/cline/task.proto`, `proto/cline/ui.proto`)
- Each feature domain has its own `.proto` file
- For simple data, use shared types in `proto/cline/common.proto` (`StringRequest`, `Empty`, `Int64Request`)
- For complex data, define custom messages in the feature's `.proto` file
- Naming: Services `PascalCaseService`, RPCs `camelCase`, Messages `PascalCase`
- For streaming responses, use `stream` keyword (see `subscribeToAuthCallback` in `account.proto`)

**Run `npm run protos`** after any proto changes—generates types in:
- `src/shared/proto/` - Shared type definitions
- `src/generated/grpc-js/` - Service implementations
- `src/generated/nice-grpc/` - Promise-based clients
- `src/generated/hosts/` - Generated handlers

**Adding new enum values** (like a new `ClineSay` type) requires updating conversion mappings in `src/shared/proto-conversions/cline-message.ts`

**Adding new RPC methods** requires:
- Handler in `src/core/controller/<domain>/`
- Call from webview via generated client: `UiServiceClient.scrollToSettings(StringRequest.create({ value: "browser" }))`

**Example—the `explain-changes` feature touched:**
- `proto/cline/task.proto` - Added `ExplainChangesRequest` message and `explainChanges` RPC
- `proto/cline/ui.proto` - Added `GENERATE_EXPLANATION = 29` to `ClineSay` enum
- `src/shared/ExtensionMessage.ts` - Added `ClineSayGenerateExplanation` type
- `src/shared/proto-conversions/cline-message.ts` - Added mapping for new say type
- `src/core/controller/task/explainChanges.ts` - Handler implementation
- `webview-ui/src/components/chat/ChatRow.tsx` - UI rendering

## Adding a New API Provider
When adding a new provider (e.g., "openai-codex"), you must update the proto conversion layer in THREE places or the provider will silently reset to Anthropic:

1. `proto/cline/models.proto` - Add to the `ApiProvider` enum (e.g., `OPENAI_CODEX = 40;`)
2. `convertApiProviderToProto()` in `src/shared/proto-conversions/models/api-configuration-conversion.ts` - Add case mapping string to proto enum
3. `convertProtoToApiProvider()` in the same file - Add case mapping proto enum back to string

**Why this matters:** Without these, the provider string hits the `default` case and returns `ANTHROPIC`. The webview, provider list, and handler all work fine, but the state silently resets when it round-trips through proto serialization. No error is thrown.

**Other files to update when adding a provider:**
- `src/shared/api.ts` - Add to `ApiProvider` union type, define models
- `src/shared/providers/providers.json` - Add to provider list for dropdown
- `src/core/api/index.ts` - Register handler in `createHandlerForProvider()`
- `webview-ui/src/components/settings/utils/providerUtils.ts` - Add cases in `getModelsForProvider()` and `normalizeApiConfiguration()`
- `webview-ui/src/utils/validate.ts` - Add validation case
- `webview-ui/src/components/settings/ApiOptions.tsx` - Render provider component

## Responses API Providers (OpenAI Codex, OpenAI Native)
Providers using OpenAI's Responses API require native tool calling. XML tools don't work with the Responses API.

**Symptoms of broken native tool calling:**
- Tools get called multiple times (e.g., `ask_followup_question` asks the same question twice)
- Tool arguments get duplicated or malformed
- The model responds but tools aren't recognized

**Root causes to check:**
1. **Provider missing from `isNextGenModelProvider()`** in `src/utils/model-utils.ts`. The native variant matchers (e.g., `native-gpt-5/config.ts`) call this function. If your provider isn't in the list, the matcher returns false and falls back to XML tools.

2. **Model missing `apiFormat: ApiFormat.OPENAI_RESPONSES`** in its model info (`src/shared/api.ts`). This property signals that the model requires native tool calling. The task runner in `src/core/task/index.ts` checks this and forces `enableNativeToolCalls: true` regardless of user settings.

**When adding a new Responses API provider:**
1. Add provider to `isNextGenModelProvider()` list in `src/utils/model-utils.ts`
2. Set `apiFormat: ApiFormat.OPENAI_RESPONSES` on all models that use the Responses API
3. The variant matcher and task runner will handle the rest automatically

## Adding Tools to System Prompt
This is tricky—multiple prompt variants and configs. **Always search for existing similar tools first and follow their pattern.** Look at the full chain from prompt definition → variant configs → handler → UI before implementing.

1. **Add to `ClineDefaultTool` enum** in `src/shared/tools.ts`
2. **Tool definition** in `src/core/prompts/system-prompt/tools/` (create file like `generate_explanation.ts`)
   - Define variants for each `ModelFamily` (generic, next-gen, xs, etc.)
   - Export variants array (e.g., `export const my_tool_variants = [GENERIC, NATIVE_NEXT_GEN, XS]`)
   - **Fallback behavior**: If a variant isn't defined for a model family, `ClineToolSet.getToolByNameWithFallback()` automatically falls back to GENERIC. So you only need to export `[GENERIC]` unless the tool needs model-specific behavior.
3. **Register in `src/core/prompts/system-prompt/tools/init.ts`** - Import and spread into `allToolVariants`
4. **Add to variant configs** - Each model family has its own config in `src/core/prompts/system-prompt/variants/*/config.ts`. Add your tool's enum to the `.tools()` list:
   - `generic/config.ts`, `next-gen/config.ts`, `gpt-5/config.ts`, `native-gpt-5/config.ts`, `native-gpt-5-1/config.ts`, `native-next-gen/config.ts`, `gemini-3/config.ts`, `glm/config.ts`, `hermes/config.ts`, `xs/config.ts`
   - **Important**: If you add to a variant's config, make sure the tool spec exports a variant for that ModelFamily (or relies on GENERIC fallback)
5. **Create handler** in `src/core/task/tools/handlers/`
6. **Wire up in `ToolExecutor.ts`** if needed for execution flow
7. **Add to tool parsing** in `src/core/assistant-message/index.ts` if needed
8. **If tool has UI feedback**: add `ClineSay` enum in proto, update `src/shared/ExtensionMessage.ts`, update `src/shared/proto-conversions/cline-message.ts`, update `webview-ui/src/components/chat/ChatRow.tsx`

## Modifying System Prompt
**Read these first:** `src/core/prompts/system-prompt/README.md`, `tools/README.md`, `__tests__/README.md`

System prompt is modular: **components** (reusable sections) + **variants** (model-specific configs) + **templates** (with `{{PLACEHOLDER}}` resolution).

**Key directories:**
- `components/` - Shared sections: `rules.ts`, `capabilities.ts`, `editing_files.ts`, etc.
- `variants/` - Model-specific: `generic/`, `next-gen/`, `xs/`, `gpt-5/`, `gemini-3/`, `hermes/`, `glm/`, etc.
- `templates/` - Template engine and placeholder definitions

**Variant tiers (ask user which to modify):**
- **Next-gen** (Claude 4, GPT-5, Gemini 2.5): `next-gen/`, `native-next-gen/`, `native-gpt-5/`, `native-gpt-5-1/`, `gemini-3/`, `gpt-5/`
- **Standard** (default fallback): `generic/`
- **Local/small models**: `xs/`, `hermes/`, `glm/`

**How overrides work:** Variants can override components via `componentOverrides` in their `config.ts`, or provide a custom template in `template.ts` (e.g., `next-gen/template.ts` exports `rules_template`). If no override, the shared component from `components/` is used.

**Example: Adding a rule to RULES section**
1. Check if variant overrides rules: look for `rules_template` in `variants/*/template.ts` or `componentOverrides.RULES` in `config.ts`
2. If shared: modify `components/rules.ts`
3. If overridden: modify that variant's template
4. XS variant is special—has heavily condensed inline content in `template.ts`

**After any changes, regenerate snapshots:**
```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```
Snapshots live in `__tests__/__snapshots__/`. Tests validate across model families and context variations (browser, MCP, focus chain).

## Modifying Default Slash Commands
Three places need updates:
- `src/core/slash-commands/index.ts` - Command definitions
- `src/core/prompts/commands.ts` - System prompt integration
- `webview-ui/src/utils/slash-commands.ts` - Webview autocomplete

## Adding New Global State Keys
Adding a new key to global state requires updates in multiple places. Missing any step causes silent failures.

Required steps:
1. Type definition in `src/shared/storage/state-keys.ts` - Add to `GlobalState` or `Settings` interface
2. Read from globalState in `src/core/storage/utils/state-helpers.ts`:
   - Add `const myKey = context.globalState.get<GlobalStateAndSettings["myKey"]>("myKey")` in `readGlobalStateFromDisk()`
   - Add to the return object: `myKey: myKey ?? defaultValue,`
3. StateManager handles read/write via `setGlobalState()`/`getGlobalStateKey()` after initialization

Common mistake: Adding only the return value without the `context.globalState.get()` call. This compiles but the value is always `undefined` on load.

## StateManager Cache vs Direct globalState Access
StateManager uses an in-memory cache populated during `StateManager.initialize(context)` in `common.ts`. For most state, use `controller.stateManager.setGlobalState()`/`getGlobalStateKey()`.

Exception: State needed immediately at extension startup (before cache is ready)

When Window A sets state and immediately opens Window B, the new window's StateManager cache is populated from `context.globalState` during initialization. If you need to read state in Window B right at startup (e.g., in `common.ts` during `initialize()`), read directly from `context.globalState.get()` instead of StateManager's cache.

Example pattern (see `lastShownAnnouncementId` and `worktreeAutoOpenPath`):
```typescript
// Writing (normal pattern)
controller.stateManager.setGlobalState("myKey", value)

// Reading at startup in common.ts (bypass cache)
const value = context.globalState.get<string>("myKey")
```

This is only needed for cross-window state read during the brief startup window before StateManager cache is fully usable. Normal state access after initialization should use StateManager.

## ChatRow Cancelled/Interrupted States
When a ChatRow displays a loading/in-progress state (spinner), you must handle what happens when the task is cancelled. This is non-obvious because cancellation doesn't update the message content—you have to infer it from context.

**The pattern:**
1. A message has a `status` field (e.g., `"generating"`, `"complete"`, `"error"`) stored in `message.text` as JSON
2. When cancelled mid-operation, the status stays `"generating"` forever—no one updates it
3. To detect cancellation, check TWO conditions:
   - `!isLast` — if this message is no longer the last message, something else happened after it (interrupted)
   - `lastModifiedMessage?.ask === "resume_task" || "resume_completed_task"` — task was just cancelled and is waiting to resume

**Example from `generate_explanation`:**
```tsx
const wasCancelled =
    explanationInfo.status === "generating" &&
    (!isLast ||
        lastModifiedMessage?.ask === "resume_task" ||
        lastModifiedMessage?.ask === "resume_completed_task")
const isGenerating = explanationInfo.status === "generating" && !wasCancelled
```

**Why both checks?**
- `!isLast` catches: cancelled → resumed → did other stuff → this old message is stale
- `lastModifiedMessage?.ask === "resume_task"` catches: just cancelled, hasn't resumed yet, this message is still technically "last"

**See also:** `BrowserSessionRow.tsx` uses similar pattern with `isLastApiReqInterrupted` and `isLastMessageResume`.

**Backend side:** When streaming is cancelled, clean up properly (close tabs, clear comments, etc.) by checking `taskState.abort` after the streaming function returns.
