# CLAUDE.md

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
