 # Implementation Plan: Remove the `/reportbug` Default Slash Command from Cline

 ## Status

 - [x] Phase 0: Confirm scope and compatibility strategy
 - [x] Phase 1: Remove `/reportbug` as a user-facing product surface
- [x] Phase 2: Remove internal `report_bug` tool/message/proto plumbing
 - [ ] Phase 3: Remove stale docs, prompts, stories, eval fixtures, and tests
 - [ ] Phase 4: Regenerate generated artifacts and prompt snapshots
 - [ ] Phase 5: Run verification, fix regressions, and complete final audit

 ---

 ## 1. Purpose of this document

 This document is a standalone implementation guide for removing the `/reportbug` default slash command from the Cline codebase.

 It is written to be useful even for someone who did **not** read the earlier design discussion. It explains:

 - what `/reportbug` is,
 - how it currently works,
 - why removal should happen in phases,
 - exactly which files and subsystems are involved,
 - what developers need to delete, update, regenerate, verify, and debug,
 - and what risks to watch for during the removal.

 The recommended approach is a **two-stage removal**:

 1. **Remove the user-facing slash command and all product references first** so users can no longer trigger it.
 2. **Remove the internal `report_bug` plumbing afterward** once the team is comfortable removing compatibility paths for older tasks/history.

 This approach is safer than deleting everything in one pass because the current implementation spans prompts, tool execution, webview behavior, CLI behavior, protobuf contracts, generated files, and persisted task history.

 ---

 ## 2. Architectural vision and intended end state

 ### End-state goal

 After the full vision is implemented:

 - `/reportbug` no longer appears in slash-command autocomplete anywhere.
 - typing `/reportbug` no longer activates a built-in Cline workflow.
 - the assistant is no longer instructed to tell users to use `/reportbug` for feedback.
 - there is no internal `report_bug` tool, approval flow, preview UI, or GitHub issue opener dedicated to this command.
 - docs, tips, tests, stories, snapshots, and fixtures no longer mention `/reportbug`.

 ### Important architectural principle

 There are really **two related things** here:

 1. the **slash command** `/reportbug`
 2. the **internal report-bug workflow** behind it (`report_bug` ask/tool/proto/UI flow)

 Removing the command from the product surface is relatively straightforward.
 Removing the underlying workflow is more invasive because it touches:

 - prompt injection,
 - tool registration,
 - ask/approval UI behavior,
 - protobuf enums and generated files,
 - CLI rendering,
 - webview action buttons,
 - and possibly historical task data.

 ### Recommended removal pattern

 Use this removal pattern:

 #### Phase 1: Product-surface removal

 Make `/reportbug` unreachable for new user interactions.

 This means removing:

 - slash command metadata,
 - slash command parsing behavior,
 - docs and tips that mention it,
 - prompt text that tells the model to recommend it,
 - tests that expect it to exist as a command.

 At the end of this phase, no new tasks should be able to create a `report_bug` ask/tool flow.

 #### Phase 2: Internal plumbing removal

 Once the team is satisfied that compatibility is no longer needed, remove the dormant plumbing:

 - `report_bug` tool enum value and handler,
 - `report_bug` ask/message types,
 - protobuf enum/RPC definitions,
 - UI renderers and utility-button wiring,
 - GitHub issue URL helper if no longer used,
 - generated protobuf outputs.

 This is the point where the codebase becomes truly free of `/reportbug` and `report_bug`.

 ---

 ## 3. How `/reportbug` works today

 This section explains the current architecture in plain language.

 ### 3.1 Shared slash-command registration

 File:

 - `src/shared/slashCommands.ts`

 This file defines the built-in slash commands that appear in autocomplete and are shared across surfaces. `/reportbug` currently exists here as a default command and is marked CLI-compatible.

 Why it matters:

 - If the entry stays here, users will still discover `/reportbug` in slash-command lists.
 - The CLI also consumes this shared metadata, so removing it here affects both VS Code/webview and CLI command discovery.

 ### 3.2 Slash-command parsing and prompt injection

 Files:

 - `src/core/slash-commands/index.ts`
 - `src/core/prompts/commands.ts`
 - `src/core/prompts/contextManagement.ts`

 When the user types `/reportbug`, the slash-command parser recognizes it as a built-in command and rewrites the prompt by prepending `reportBugToolResponse()`.

 That injected prompt tells the model:

 - the user wants help filing a GitHub issue,
 - the model should gather required fields,
 - and then it should call the `report_bug` tool.

 `contextManagement.ts` also explicitly treats `/reportbug` as a resumable special command when a conversation continues after compaction.

 Why it matters:

 - This is the logical point where `/reportbug` becomes a special workflow instead of ordinary user text.
 - If this parser entry remains, the command still exists behaviorally even if some UI references are removed.

 ### 3.3 Tool definition and execution

 Files:

 - `src/shared/tools.ts`
 - `src/core/task/tools/ToolExecutorCoordinator.ts`
 - `src/core/task/tools/handlers/ReportBugHandler.ts`

 `report_bug` is a first-class built-in tool. It is registered in the shared tool enum and routed to `ReportBugHandler`.

 `ReportBugHandler` currently does all of the following:

 - validates parameters,
 - derives environment metadata (OS, host, version, provider/model),
 - asks the user to confirm the bug report,
 - shows a preview payload,
 - and on approval opens a prefilled GitHub issue URL.

 Why it matters:

 - This is the actual engine behind the slash command.
 - Removing `/reportbug` completely eventually means this tool should disappear too.

 ### 3.4 GitHub issue opening utility

 File:

 - `src/utils/github-url-utils.ts`

 This utility creates a GitHub issue URL and opens it in the browser with OS-level fallbacks. It exists to avoid VS Code URI encoding issues.

 Current known usage:

 - `ReportBugHandler` is its known consumer.

 Why it matters:

 - If no other features use this utility after `report_bug` removal, it can likely be deleted.
 - If another feature adopts it later, keep it and remove only the dead import/use site.

 ### 3.5 Webview ask/approval flow

 Files:

 - `webview-ui/src/components/chat/ChatRow.tsx`
 - `webview-ui/src/components/chat/ReportBugPreview.tsx`
 - `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`
 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.test.ts`

 The webview treats `report_bug` as a dedicated ask type.

 It has:

 - a preview renderer (`ReportBugPreview.tsx`),
 - a message branch in `ChatRow.tsx`,
 - special button configuration (`Report GitHub issue`),
 - and utility-button behavior that calls `SlashServiceClient.reportBug(...)`.

 Why it matters:

 - This is not just generic tool approval UI.
 - `/reportbug` has bespoke frontend treatment that must be cleaned up.

 ### 3.6 Slash-service RPC path

 Files:

 - `proto/cline/slash.proto`
 - `src/core/controller/slash/reportBug.ts`

 The webview utility-button flow uses a dedicated slash-service RPC named `reportBug`.

 That controller implementation is minimal: it effectively forwards a `yesButtonClicked` approval back into the active task.

 Why it matters:

 - If the `report_bug` ask type goes away, this RPC becomes dead and should be removed.
 - Because it is in proto, removal requires regenerated code.

 ### 3.7 Shared message/protobuf contract

 Files:

 - `src/shared/ExtensionMessage.ts`
 - `src/shared/proto-conversions/cline-message.ts`
 - `proto/cline/ui.proto`
 - generated protobuf files under `src/generated/` and `src/shared/proto/`

 `report_bug` is encoded as a dedicated `ClineAsk` value in both app-layer types and protobuf enums.

 Why it matters:

 - This is where compatibility risk lives.
 - Deleting enum values carelessly can break deserialization or historical tasks.

 ### 3.8 CLI rendering and translation

 Files:

 - `cli/src/components/ChatMessage.tsx`
 - `cli/src/agent/messageTranslator.ts`
 - `cli/src/components/FeatureTip.tsx`

 The CLI has its own rendering branch for `ask === "report_bug"` and its own feature tip text mentioning `/reportbug`.

 Why it matters:

 - Removing the command only in webview would leave stale behavior/documentation in the CLI.

 ### 3.9 Prompt references and system-prompt snapshots

 Files include:

 - `src/core/prompts/system-prompt/components/feedback.ts`
 - `src/core/prompts/system-prompt/variants/*`
 - `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`
 - many files under `src/core/prompts/system-prompt/__tests__/__snapshots__/`

 Today, several prompt variants explicitly tell the model to advise users to use `/reportbug` when they want to give feedback.

 Why it matters:

 - If the command is removed but prompt text remains, the model will keep recommending a non-existent feature.

 ---

 ## 4. Important risks and constraints

 ### 4.1 Compatibility risk: historical tasks/messages

 Old task history may still contain messages with:

 - `ask: "report_bug"`
 - or protobuf enum values corresponding to `REPORT_BUG`.

 If internal plumbing is removed too aggressively, historical messages may:

 - render badly,
 - lose button behavior,
 - show unknown/unrecognized message states,
 - or fail conversion if protobuf handling is not done carefully.

 ### 4.2 Protobuf rule: do not renumber enums

 If `REPORT_BUG = 14` is removed from `proto/cline/ui.proto`, **do not reuse or shift that number**.

 Recommended safe approach when fully removing it:

 - remove the symbolic enum member from active use,
 - preserve wire compatibility by reserving the number and name if appropriate,
 - regenerate generated files with `npm run protos`.

 In plain language: protobuf enum numbers are part of the data contract. Reordering or renumbering them can make old data look like a different message type.

 ### 4.3 Generated-code risk

 Changes to `proto/cline/ui.proto` or `proto/cline/slash.proto` require:

 - `npm run protos`

 If this step is skipped, TypeScript code and generated clients/handlers will go out of sync.

 ### 4.4 Prompt snapshot risk

 Removing prompt text will change system prompt snapshots.

 The project guidance for prompt changes is to regenerate snapshots with:

 - `UPDATE_SNAPSHOTS=true npm run test:unit`

 ### 4.5 Existing inconsistency already present today

 `src/core/prompts/commands.ts` describes `api_request_output` and `additional_context` as optional, but `ReportBugHandler.ts` currently validates them as required.

 This inconsistency is worth documenting because:

 - it may confuse developers while reading the old flow,
 - and it is a sign that the current feature has drifted internally.

 It does **not** block removal, but it explains why the removal plan prefers deleting the entire feature instead of trying to “clean it up first.”

 ---

 ## 5. Recommended implementation strategy

 ## Phase 0 — Confirm the removal policy

 - [x] Decide whether removal is a **single release with compatibility fallback** or a **true multi-release phased removal**.
 - [x] Decide how much legacy task-history compatibility is required.
 - [x] Decide whether `src/utils/github-url-utils.ts` should be deleted or retained for future reuse.

 ### Recommendation

 Preferred policy:

 - **Phase 1 in the next change set:** remove the product-facing command and references.
 - **Phase 2 in the same branch or a follow-up branch:** remove internal plumbing only after validating no compatibility requirement blocks it.

 If the team wants the cleanest possible repository immediately, the full removal can still happen in one implementation branch — but the work should still be performed conceptually in two phases so compatibility is handled intentionally.

 ---

 ## Phase 1 — Remove `/reportbug` as a user-facing feature

 ### Goal

 Make it impossible for users to newly discover or trigger `/reportbug`.

 ### Files to update

 #### Slash-command registration

 - [x] Remove `/reportbug` from `src/shared/slashCommands.ts`

 Why:

 - This removes the command from shared autocomplete data.
 - CLI and non-CLI surfaces both derive available slash commands from this area.

 #### Slash-command parsing

 - [x] Remove `"reportbug"` from `SUPPORTED_DEFAULT_COMMANDS` in `src/core/slash-commands/index.ts`
 - [x] Remove the `reportbug: reportBugToolResponse()` replacement entry from `src/core/slash-commands/index.ts`
 - [x] Remove the `reportBugToolResponse` import from `src/core/slash-commands/index.ts`

 Why:

 - This prevents `/reportbug` from being rewritten into explicit report-bug instructions.

 #### Slash-command prompt helper

 - [x] Remove `reportBugToolResponse()` from `src/core/prompts/commands.ts` if no longer needed anywhere

 Why:

 - Once the slash parser no longer invokes it, this helper becomes dead code.

 #### Continuation/compaction behavior

 - [x] Remove `/reportbug` from the special-command sentence in `src/core/prompts/contextManagement.ts`

 Why:

 - The compaction continuation logic should not mention a command that no longer exists.

 #### User-facing docs and tips

 - [x] Remove `/reportbug` from `docs/core-workflows/using-commands.mdx`
 - [x] Remove `/reportbug` from `docs/getting-started/your-first-project.mdx`
 - [x] Remove the feature tip reference from `webview-ui/src/components/chat/FeatureTip.tsx`
 - [x] Remove the feature tip reference from `cli/src/components/FeatureTip.tsx`

 Why:

 - These are direct user-facing references and would otherwise advertise a removed feature.

 #### Prompt text that recommends `/reportbug`

 - [x] Remove/update `src/core/prompts/system-prompt/components/feedback.ts`
 - [x] Remove/update prompt variant overrides/templates that explicitly mention `/reportbug`
   - `src/core/prompts/system-prompt/variants/gemini-3/overrides.ts`
   - `src/core/prompts/system-prompt/variants/native-gpt-5/template.ts`
   - `src/core/prompts/system-prompt/variants/native-gpt-5-1/overrides.ts`
   - `src/core/prompts/system-prompt/variants/native-next-gen/template.ts`
 - [x] Remove/update legacy prompt text in `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`

 Why:

 - If these strings remain, the model will still instruct users to use a removed command.

 #### Tests and fixtures tied to command existence

 - [x] Audit and update any tests or fixtures that assume `/reportbug` exists
 - [x] Re-run slash-command tests under `src/core/slash-commands/__tests__/`
 - [x] Remove or update eval/prompt fixtures that mention `/reportbug`
   - e.g. `evals/benchmarks/tool-precision/replace-in-file/prompts/claude4SystemPrompt-06-06-25.ts`

  Verification note:

  - The targeted `npx cross-env TS_NODE_PROJECT=./tsconfig.unit-test.json mocha --config .mocharc.json src/core/slash-commands/__tests__/index.test.ts` run confirmed the slash-command tests passed, while the broader prompt integration suite reported expected snapshot mismatches from the feedback-text change. Snapshot updates are deferred to Phase 4.

 ### Phase 1 completion check

 At the end of Phase 1:

 - `/reportbug` should not appear in autocomplete.
 - the parser should not recognize it as a built-in command.
 - docs/tips/prompts should stop mentioning it.
 - no new `report_bug` asks should be creatable through normal product flows.

 ---

 ## Phase 2 — Remove the internal `report_bug` workflow plumbing

 ### Goal

 Delete the dormant internal architecture that exists only to support `/reportbug`.

 ### 2A. Remove tool-level plumbing

 - [x] Remove `REPORT_BUG = "report_bug"` from `src/shared/tools.ts`
 - [x] Remove `ReportBugHandler` registration from `src/core/task/tools/ToolExecutorCoordinator.ts`
 - [x] Delete `src/core/task/tools/handlers/ReportBugHandler.ts`

 Optional follow-up:

 - [ ] If `createAndOpenGitHubIssue()` is now unused, remove its import site and delete `src/utils/github-url-utils.ts`
 - [x] If the utility is worth keeping for future reuse, leave it in place but ensure it has no dead comments or reportbug-specific references elsewhere.

 ### 2B. Remove the ask/message type from app-layer types

 - [x] Remove `"report_bug"` from `ClineAsk` in `src/shared/ExtensionMessage.ts`
 - [x] Remove `report_bug` mapping entries from `src/shared/proto-conversions/cline-message.ts`

 Why:

 - The app-layer message contract should no longer advertise a report-bug ask state.

 ### 2C. Remove protobuf enum usage safely

 Files:

 - `proto/cline/ui.proto`
 - generated files in `src/generated/` and `src/shared/proto/`

 Steps:

 - [x] Remove active use of `REPORT_BUG` from `proto/cline/ui.proto`
 - [x] Preserve protobuf compatibility safely (do **not** renumber later enum members)
 - [x] Reserve the old enum number/name if that matches project protobuf conventions
 - [x] Run `npm run protos`

 Plain-language warning:

 - Removing enum item 14 and then shifting later values upward would be a bug.
 - Old stored data could be interpreted as a completely different ask type.

 ### 2D. Remove SlashService RPC plumbing

 Files:

 - `proto/cline/slash.proto`
 - `src/core/controller/slash/reportBug.ts`
 - generated slash-service code

 Steps:

 - [x] Remove `rpc reportBug(StringRequest) returns (Empty);` from `proto/cline/slash.proto`
 - [x] Delete `src/core/controller/slash/reportBug.ts`
 - [x] Remove any controller/service registration that wires this RPC in
 - [x] Run `npm run protos`

 ### 2E. Remove webview-specific `report_bug` UI behavior

 Files:

 - `webview-ui/src/components/chat/ReportBugPreview.tsx`
 - `webview-ui/src/components/chat/ChatRow.tsx`
 - `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`
 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.test.ts`
 - `webview-ui/src/App.stories.tsx`

 Steps:

 - [x] Delete `ReportBugPreview.tsx`
 - [x] Remove the `case "report_bug"` renderer branch from `ChatRow.tsx`
 - [x] Remove the `report_bug` handling in `useMessageHandlers.ts`
   - both the `askResponse` path and the `SlashServiceClient.reportBug(...)` utility path
 - [x] Remove the `report_bug` button config from `buttonConfig.ts`
 - [x] Update `getButtonConfig()` so it no longer returns a config for `report_bug`
 - [x] Update `buttonConfig.test.ts`
 - [x] Remove/update any webview story using `report_bug`

 Why:

 - This is bespoke UI state that exists only for this feature.

 ### 2F. Remove CLI-specific `report_bug` rendering

 Files:

 - `cli/src/components/ChatMessage.tsx`
 - `cli/src/agent/messageTranslator.ts`
 - `cli/src/components/FeatureTip.tsx`

 Steps:

 - [x] Remove the `ask === "report_bug"` render branch from `ChatMessage.tsx`
 - [x] Remove or simplify any translator handling that references `report_bug`
 - [ ] Remove the `/reportbug` feature tip text

 ---

 ## Phase 3 — Remove stale references, fixtures, and generated noise

 ### Prompt snapshots

 - [ ] Update/remove stale prompt snapshots under `src/core/prompts/system-prompt/__tests__/__snapshots__/`

 Use:

 - `UPDATE_SNAPSHOTS=true npm run test:unit`

 ### Generated protobuf files

 - [ ] Regenerate after proto edits using `npm run protos`
 - [ ] Review changes under `src/generated/` and `src/shared/proto/`

 ### Eval and benchmark fixtures

 - [ ] Remove/update `report_bug` references in eval fixtures and parsing fixtures
 - [ ] Re-run any relevant benchmark or fixture validation if this repository expects it

 ### Audit command

 Use this final grep repeatedly until it returns only intentional historical references (or nothing):

 ```bash
 rg -n --hidden --glob '!.git' '/reportbug|report_bug|REPORT_BUG' /Users/evekillaby/dev/github.com/cline/cline1
 ```

 ---

 ## 6. Recommended verification workflow

 Run these in order after the code changes are made.

 ### 6.1 Regenerate protobuf outputs

 ```bash
 npm run protos
 ```

 Why:

 - Required if `proto/cline/ui.proto` or `proto/cline/slash.proto` changed.

 ### 6.2 Typecheck everything

 ```bash
 npm run check-types
 ```

 Why:

 - This catches missing imports, invalid unions, removed enum members still referenced, and CLI/webview TS errors.

 ### 6.3 Lint

 ```bash
 npm run lint
 ```

 Why:

 - This catches dead imports and syntax/style problems created by deletions.

 ### 6.4 Prompt/unit tests and snapshots

 ```bash
 UPDATE_SNAPSHOTS=true npm run test:unit
 ```

 Why:

 - Prompt text and snapshots will change after removing `/reportbug` references.

 ### 6.5 CLI tests

 ```bash
 npm run cli:test
 ```

 Why:

 - The CLI has explicit report-bug rendering and feature-tip behavior.

 ### 6.6 Build checks

 ```bash
 npm run compile
 npm run cli:build
 ```

 Why:

 - This validates the extension build and CLI build after the removal.

 ### 6.7 Optional full test suite

 ```bash
 npm test
 ```

 Why:

 - Good final confidence pass if the branch is nearing merge.

 ---

 ## 7. Debugging guide

 ### Symptom: TypeScript errors about `report_bug` still existing

 Likely cause:

 - a union type, switch branch, or mapping table still references it.

 Places to check first:

 - `src/shared/ExtensionMessage.ts`
 - `src/shared/proto-conversions/cline-message.ts`
 - `webview-ui/src/components/chat/ChatRow.tsx`
 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
 - `cli/src/components/ChatMessage.tsx`

 ### Symptom: Generated files still mention `REPORT_BUG`

 Likely cause:

 - `npm run protos` was not run after proto edits.

 ### Symptom: Prompt snapshot tests fail

 Likely cause:

 - prompt text still changed but snapshots were not regenerated.

 Use:

 ```bash
 UPDATE_SNAPSHOTS=true npm run test:unit
 ```

 ### Symptom: Webview action buttons break or show the wrong state

 Likely cause:

 - `buttonConfig.ts` and `useMessageHandlers.ts` are out of sync.

 Check:

 - `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
 - `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`

 ### Symptom: Historical tasks render oddly

 Likely cause:

 - old tasks still contain `report_bug` ask values.

 Options:

 - temporarily keep a legacy renderer for old history,
 - migrate stored task data if the project has a migration path,
 - or accept degraded rendering for legacy tasks if product policy allows it.

 ### Symptom: protobuf enum mismatch or deserialization issues

 Likely cause:

 - enum numbers were renumbered or reused.

 Fix:

 - restore enum number stability,
 - reserve the old number/name instead of shifting later entries,
 - regenerate code.

 ---

 ## 8. File-by-file removal checklist

 ## A. Slash-command layer

 - [x] `src/shared/slashCommands.ts`
 - [x] `src/core/slash-commands/index.ts`
 - [x] `src/core/prompts/commands.ts`
 - [x] `src/core/prompts/contextManagement.ts`
 - [x] `src/core/slash-commands/__tests__/index.test.ts` (if command expectations exist or need adding)

 ## B. Tool execution layer

 - [x] `src/shared/tools.ts`
 - [x] `src/core/task/tools/ToolExecutorCoordinator.ts`
 - [x] `src/core/task/tools/handlers/ReportBugHandler.ts`
 - [x] `src/utils/github-url-utils.ts` (retained; still used by `openUrl` flow)

 ## C. Controller/proto layer

 - [x] `proto/cline/ui.proto`
 - [x] `proto/cline/slash.proto`
 - [x] `src/core/controller/slash/reportBug.ts`
 - [x] `src/shared/ExtensionMessage.ts`
 - [x] `src/shared/proto-conversions/cline-message.ts`
 - [x] regenerated files under `src/generated/` and `src/shared/proto/`

 ## D. Webview layer

 - [x] `webview-ui/src/components/chat/ReportBugPreview.tsx`
 - [x] `webview-ui/src/components/chat/ChatRow.tsx`
 - [x] `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`
 - [x] `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`
 - [x] `webview-ui/src/components/chat/chat-view/shared/buttonConfig.test.ts`
 - [x] `webview-ui/src/App.stories.tsx`
 - [x] `webview-ui/src/components/chat/FeatureTip.tsx`

 ## E. CLI layer

 - [x] `cli/src/components/ChatMessage.tsx`
 - [x] `cli/src/agent/messageTranslator.ts`
 - [x] `cli/src/components/FeatureTip.tsx`

 ## F. Prompt/docs/reference layer

 - [x] `src/core/prompts/system-prompt/components/feedback.ts`
 - [x] `src/core/prompts/system-prompt/variants/gemini-3/overrides.ts`
 - [x] `src/core/prompts/system-prompt/variants/native-gpt-5/template.ts`
 - [x] `src/core/prompts/system-prompt/variants/native-gpt-5-1/overrides.ts`
 - [x] `src/core/prompts/system-prompt/variants/native-next-gen/template.ts`
 - [x] `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`
 - [ ] affected prompt snapshot files
 - [x] `docs/core-workflows/using-commands.mdx`
 - [x] `docs/getting-started/your-first-project.mdx`
 - [x] eval fixtures and parsing fixtures mentioning `/reportbug` or `report_bug`

 ---

 ## 9. Definition of done

 The removal is complete when all of the following are true:

 - [x] `/reportbug` no longer appears in slash command metadata or autocomplete
 - [x] typing `/reportbug` no longer triggers any built-in behavior
 - [x] the model is no longer instructed to recommend `/reportbug`
- [x] no app-layer `report_bug` ask/tool/proto paths remain (if Phase 2 is complete)
- [x] no stale webview or CLI rendering branches remain
- [x] no stale slash-service RPC remains
- [x] generated protobuf files are up to date
 - [ ] prompt snapshots are regenerated and passing
 - [ ] typecheck, lint, unit tests, and CLI tests pass
 - [ ] grep audit confirms no unintended `/reportbug`, `report_bug`, or `REPORT_BUG` references remain

 ---

 ## 10. Final recommendation

 If the team wants the safest implementation path:

 1. ship **Phase 1** first so the feature disappears from the product surface,
 2. verify there is no hidden dependency or history concern,
 3. then complete **Phase 2** to remove the underlying plumbing.

 If the team wants to complete the full vision in one branch, still execute the work in the order above.

 The most important technical rule is simple:

 > Remove the user-facing command first, and remove protobuf/message/tool internals only after handling compatibility intentionally.

 That sequencing minimizes risk while still achieving the clean final architecture.