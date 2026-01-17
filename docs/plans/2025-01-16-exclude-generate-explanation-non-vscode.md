# Exclude generate_explanation Tool from Non-VS Code Platforms Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add platform-specific filtering to exclude the `generate_explanation` tool from the system prompt when running on non-VS Code IDEs (e.g., JetBrains, CLI), as the feature relies on VS Code's Comments API.

**Architecture:** The `generate_explanation` tool spec will include a `contextRequirements` function that checks `context.ide === "Visual Studio Code"`. The existing tool filtering system already evaluates `contextRequirements` during prompt generation, so this follows established patterns used by other tools like `browser_action`, `web_fetch`, and `focus_chain`.

**Tech Stack:** TypeScript, Node.js, Mocha (testing), npm scripts

---
## Task 1: Add contextRequirements to generate_explanation tool

**Files:**
- Modify: `src/core/prompts/system-prompt/tools/generate_explanation.ts:7-36`

**Step 1: Read the current implementation**

Run: `cat src/core/prompts/system-prompt/tools/generate_explanation.ts`

Expected: See the GENERIC ClineToolSpec without `contextRequirements`

**Step 2: Add contextRequirements to the GENERIC spec**

Add the `contextRequirements` property to the GENERIC object, following the pattern from `browser_action.ts:16`:

```typescript
const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "generate_explanation",
	description:
		"Opens a multi-file diff view and generates AI-powered inline comments explaining the changes between two git references. Use this tool to help users understand code changes from git commits, pull requests, branches, or any git refs. The tool uses git to retrieve file contents and displays a side-by-side diff view with explanatory comments.",
	contextRequirements: (context) => context.ide === "Visual Studio Code",
	parameters: [
		// ... existing parameters ...
	],
}
```

Run: Open `src/core/prompts/system-prompt/tools/generate_explanation.ts` and add the line after `description` and before `parameters`.

**Step 3: Verify the file syntax**

Run: `npm run compile`

Expected: No compilation errors

**Step 4: Commit**

```bash
git add src/core/prompts/system-prompt/tools/generate_explanation.ts
git commit -m "feat: exclude generate_explanation tool from non-VS Code platforms"
```

---
## Task 2: Update test snapshots

**Files:**
- Modify: Multiple snapshot files in `src/core/prompts/system-prompt/__tests__/__snapshots__/`
- Modify: `src/core/prompts/system-prompt/__tests__/integration.test.ts`

**Step 1: Update integration test context variations**

Add a new context variation for non-VS Code IDEs in `integration.test.ts:184-189`:

```typescript
const contextVariations: Array<{ name: string; override: Partial<SystemPromptContext> }> = [
	{ name: "basic", override: {} },
	{ name: "no-browser", override: { supportsBrowserUse: false } },
	{ name: "no-mcp", override: { mcpHub: { getServers: () => [] } as unknown as McpHub } },
	{ name: "no-focus-chain", override: { focusChainSettings: { enabled: false, remindClineInterval: 0 } } },
	{ name: "jetbrains-ide", override: { ide: "JetBrains" } }, // NEW: Test non-VS Code IDE
]
```

Run: Edit the file to add the new context variation

**Step 2: Regenerate snapshots with UPDATE_SNAPSHOTS**

Run: `UPDATE_SNAPSHOTS=true npm run test:unit`

Expected: Test output showing snapshots being updated. The new `jetbrains-ide` snapshots should NOT include the `generate_explanation` tool.

**Step 3: Verify snapshot changes**

Check one of the snapshot files to confirm `generate_explanation` is absent from JetBrains context:

Run: `grep -r "generate_explanation" src/core/prompts/system-prompt/__tests__/__snapshots__/ | grep -v "no-browser" | head -5`

Expected: Only VS Code context snapshots contain `generate_explanation`; JetBrains snapshots do not

**Step 4: Run tests without UPDATE_SNAPSHOTS to verify**

Run: `npm run test:unit`

Expected: All tests pass

**Step 5: Commit**

```bash
git add src/core/prompts/system-prompt/__tests__/ src/core/prompts/system-prompt/tools/
git commit -m "test: update snapshots for generate_explanation IDE filtering"
```

---
## Task 3: Manual verification (optional but recommended)

**Step 1: Build the extension**

Run: `npm run compile`

**Step 2: Launch the extension**

Run: Press `F5` in VS Code to launch the Extension Development host

**Step 3: Verify system prompt content**

In the Extension Development host, open Cline and check that `generate_explanation` tool is still available (since we're running in VS Code).

---
## Task 4: Create changeset

**Step 1: Run changeset**

Run: `npm run changeset`

Select options:
- Type: `patch` (this is a bug fix/feature exclusion)
- Description: "Exclude generate_explanation tool from system prompt on non-VS Code platforms"

**Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for generate_explanation IDE filtering"
```

---
## Summary of Changes

This implementation adds a single-line `contextRequirements` function to the `generate_explanation` tool spec that filters it out when the IDE is not VS Code. The change:

1. Follows the existing pattern used by other platform-specific tools (`browser_action`, `web_fetch`, `focus_chain`)
2. Leverages the existing `contextRequirements` evaluation logic in `PromptBuilder.ts:155` and `ClineToolSet.ts:101`
3. Requires updating test snapshots to reflect the filtered behavior
4. Is backward compatible (the tool remains available on VS Code)

**Reference files:**
- Pattern reference: `src/core/prompts/system-prompt/tools/browser_action.ts:16`
- Context type: `src/core/prompts/system-prompt/types.ts:97` (ide field)
- Filtering logic: `src/core/prompts/system-prompt/registry/PromptBuilder.ts:155`

**Testing strategy:**
- Snapshot tests verify the tool is excluded from non-VS Code contexts
- Manual verification in VS Code confirms tool is still available
- No functional code changes needed—the filtering happens at prompt generation time
