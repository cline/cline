# Implementation Plan

[Overview]
Create 6 new documentation pages (and 1 update to an existing page) to address the most significant gaps in Cline's user-facing documentation.

After a comprehensive cross-reference of every feature in the Cline codebase against the existing docs site, 6 high-impact features were identified as having little to no documentation despite being fully shipped, user-facing capabilities. Each documentation page will be created as an independent unit suitable for its own PR. All pages follow the established Mintlify `.mdx` format with YAML frontmatter (`title`, `sidebarTitle`, `description`), no H1 headings (title comes from frontmatter), H2 for major sections, H3 for subsections, and Mintlify callout components (`<Tip>`, `<Warning>`, `<Note>`, `<Info>`) for admonitions. The `docs/docs.json` navigation file must be updated for each new page to wire it into the site.

The 6 PRs in priority order:
1. **Prompts Library** — Major user-facing feature with zero documentation
2. **Commands & Keybindings Reference** — 18+ VS Code commands and 3 keybindings with no unified reference
3. **VS Code Extension API** — Extension-to-extension `ClineAPI` interface with zero docs-site presence
4. **Tools Reference Update** — Existing page missing 14 of 27 tools
5. **Explain Changes Feature** — Full `/explain-changes` slash command with no dedicated page
6. **Context Management Deep-Dive** — Only the "Auto Compact" surface is documented; underlying system invisible to users

[Types]
No new TypeScript types, interfaces, or data structures are needed — this is a documentation-only task.

All referenced types already exist in the codebase:
- `PromptItem` interface in `src/shared/prompts.ts` — fields: `promptId`, `githubUrl`, `name`, `author`, `description`, `content`, `type` (enum: `"rule"`, `"workflow"`, `"hook"`, `"skill"`), `tags`
- `ClineAPI` interface in `src/exports/cline.d.ts` — methods: `startNewTask(task?, images?)`, `sendMessage(message?, images?)`, `pressPrimaryButton()`, `pressSecondaryButton()`
- `ClineDefaultTool` enum in `src/shared/tools.ts` — 27 values (see Tools Reference section below for full list)
- `ContextManager` class in `src/core/context/context-management/ContextManager.ts` — truncation strategies: `"none"`, `"lastTwo"`, `"half"`, `"quarter"`

[Files]
6 new documentation files and 1 updated existing file, plus `docs.json` navigation updates for each PR.

### New Files

**PR 1:** `docs/features/prompts-library.mdx`
- Purpose: Document the Prompts Library feature — browsing, searching, applying, and removing community prompts
- Sections: What is the Prompts Library, Accessing It, Browsing & Searching, Applying a Prompt (with per-type file destinations), Removing a Prompt, CLI Support, Submitting Your Own Prompts
- Source of truth: `src/services/prompts/PromptsService.ts`, `src/shared/prompts.ts`, `webview-ui/src/components/prompts/PromptsLibraryView.tsx`, `src/core/controller/prompts/applyPrompt.ts`, `src/core/controller/prompts/removePrompt.ts`

**PR 2:** `docs/core-workflows/commands-and-keybindings.mdx`
- Purpose: Unified reference for all VS Code commands, keyboard shortcuts, context menu actions, and IDE integrations
- Sections: Keyboard Shortcuts, Editor Context Menu, Terminal Context Menu, SCM Integration (Git Commit Message Generation), Code Review Integration, Command Palette Commands, Jupyter Notebook Commands
- Source of truth: `package.json` "contributes" section (commands, keybindings, menus)

**PR 3:** `docs/features/extension-api.mdx`
- Purpose: Document the `ClineAPI` interface for extension-to-extension integration
- Sections: What is the Extension API, Accessing the API, API Methods (with signatures and examples), Use Cases
- Source of truth: `src/exports/cline.d.ts`, `src/exports/index.ts`, `src/exports/README.md`

**PR 5:** `docs/features/explain-changes.mdx`
- Purpose: Document the `/explain-changes` slash command and its multi-file diff view with AI-generated inline comments
- Sections: What is Explain Changes, How to Use It, Git Reference Formats, Understanding the Output, Use Cases
- Source of truth: `src/core/controller/task/explainChanges.ts`, `src/core/slash-commands/index.ts`

**PR 6:** `docs/features/context-management.mdx`
- Purpose: Deep-dive into how Cline manages context windows — what counts toward context, optimization strategies, truncation, and tips
- Sections: How Context Works, What Counts Toward Your Context Window, Context Optimizations (duplicate file read detection), Truncation Strategies, Model-Specific Context Windows, Auto Compact, The Condense Tool, Tips for Staying Within Limits
- Source of truth: `src/core/context/context-management/ContextManager.ts`, `docs/features/auto-compact.mdx` (cross-reference), `docs/model-config/context-windows.mdx` (cross-reference)

### Modified Files

**PR 4:** `docs/tools-reference/all-cline-tools.mdx` (UPDATE existing file)
- Purpose: Add the 14 missing tools to the existing tools reference page
- Missing tools to add: `apply_patch`, `web_search`, `web_fetch`, `new_task`, `condense`, `summarize_task`, `focus_chain`, `use_skill`, `use_subagents`, `generate_explanation`, `new_rule`, `report_bug`, `plan_mode_respond`, `act_mode_respond`
- Source of truth: `src/shared/tools.ts` (ClineDefaultTool enum), tool handler files in `src/core/task/tools/handlers/`, tool definitions in `src/core/prompts/system-prompt/tools/`

**ALL PRs:** `docs/docs.json` (UPDATE navigation)
- PR 1: Add `"features/prompts-library"` to the Features group pages array
- PR 2: Add `"core-workflows/commands-and-keybindings"` to the Core Workflows group pages array
- PR 3: Add `"features/extension-api"` to the Features group pages array
- PR 4: No `docs.json` change needed (page already exists)
- PR 5: Add `"features/explain-changes"` to the Features group pages array
- PR 6: Add `"features/context-management"` to the Features group pages array

[Functions]
No new functions are needed — this is a documentation-only task.

All referenced functions already exist:
- `PromptsService.fetchCatalog()` — fetches prompt catalog from GitHub API (`https://api.github.com/repos/cline/prompts/git/trees/main?recursive=1`)
- `applyPrompt(controller, request)` — writes prompt content to the appropriate file path based on prompt type
- `removePrompt(controller, request)` — deletes the prompt file from disk
- `fetchPromptsCatalog(controller, request)` — RPC handler that calls PromptsService
- `explainChanges(controller, request)` — generates AI explanations for git diffs between two refs
- `ContextManager.shouldCompactContextWindow()` — checks if token usage exceeds threshold
- `ContextManager.getNextTruncationRange()` — calculates next truncation range with strategy
- `ContextManager.applyContextOptimizations()` — detects and replaces duplicate file reads

[Classes]
No new classes are needed — this is a documentation-only task.

Referenced classes for accurate documentation:
- `PromptsService` in `src/services/prompts/PromptsService.ts` — singleton, 1-hour cache, fetches from GitHub Git Tree API
- `ContextManager` in `src/core/context/context-management/ContextManager.ts` — instantiated per Task, handles all context window optimization

[Dependencies]
No new dependencies are needed — this is a documentation-only task.

The docs site uses Mintlify (`docs/package.json`). No additional packages are required.

[Testing]
No automated tests are needed for documentation changes.

Validation strategy:
- Each `.mdx` file must have valid YAML frontmatter with `title`, `sidebarTitle`, and `description` fields
- Each new page must be wired into `docs.json` navigation (except PR 4 which updates an existing page)
- Cross-reference all technical claims against source code (file paths, function names, types, behaviors)
- Verify no broken internal links (e.g., links to other docs pages use relative paths without `.mdx` extension)
- Run the Mintlify dev server locally (`cd docs && npx mintlify dev`) to verify pages render correctly

[Implementation Order]
Each PR is independent and can be implemented in any order. The recommended sequence below optimizes for impact and minimizes cross-dependencies.

1. **PR 1 — Prompts Library** (`docs/features/prompts-library.mdx` + `docs.json` update)
   - Highest impact: major feature with zero docs, primary discovery mechanism for customization ecosystem
   - No dependencies on other PRs
   - Source files to read for accuracy: `src/shared/prompts.ts`, `src/services/prompts/PromptsService.ts`, `src/core/controller/prompts/applyPrompt.ts`, `src/core/controller/prompts/removePrompt.ts`, `webview-ui/src/components/prompts/PromptsLibraryView.tsx`
   - Prompt types and their destination paths when applied:
     - `"rule"` → `.clinerules/{name}.md`
     - `"workflow"` → `.clinerules/workflows/{name}.md`
     - `"hook"` → global hooks dir (`~/Documents/Cline/Hooks/`) or workspace (`.clinerules/hooks/`)
     - `"skill"` → `.clinerules/skills/{name}.md`
   - Catalog source: GitHub Git Tree API on `cline/prompts` repo
   - UI access: Book icon button (📖) in Cline toolbar → PromptsLibraryView
   - CLI access: `/settings` → Prompts tab in settings panel

2. **PR 2 — Commands & Keybindings Reference** (`docs/core-workflows/commands-and-keybindings.mdx` + `docs.json` update)
   - High impact: users constantly ask about keyboard shortcuts and miss context menu features
   - No dependencies on other PRs
   - Source file: `package.json` "contributes" section
   - Exact keybindings to document:
     - `Cmd+.` (Mac) / `Ctrl+.` (Win/Linux) → `cline.focusChatInput` (Jump to Chat Input)
     - `Cmd+'` (Mac) / `Ctrl+'` (Win/Linux) → Opens Cline in editor tab (condition: `!cline.isInEditorPanel`)
     - `Cmd+Shift+'` (Mac) / `Ctrl+Shift+'` (Win/Linux) → `cline.plusButtonClicked` (New Task in tab, condition: `cline.isInEditorPanel`)
   - Exact context menu commands:
     - Editor context menu: `cline.addToChat` ("Add to Cline"), `cline.explainCode` ("Explain with Cline"), `cline.improveCode` ("Improve with Cline")
     - Terminal context menu: `cline.addTerminalOutputToChat` ("Add to Cline")
     - SCM title bar: `cline.generateGitCommitMessage` ("Generate Commit Message with Cline")
     - Jupyter: `cline.jupyterGenerateCell`, `cline.jupyterExplainCell`, `cline.jupyterImproveCell`
     - Code review: `cline.reviewComment.reply` ("Reply"), `cline.reviewComment.addToChat` ("Add to Cline Chat")

3. **PR 3 — VS Code Extension API** (`docs/features/extension-api.mdx` + `docs.json` update)
   - High impact for developers building on Cline
   - No dependencies on other PRs
   - Source files: `src/exports/cline.d.ts`, `src/exports/index.ts`, `src/exports/README.md`
   - Exact `ClineAPI` interface:
     ```typescript
     interface ClineAPI {
       startNewTask(task?: string, images?: string[]): Promise<void>
       sendMessage(message?: string, images?: string[]): Promise<void>
       pressPrimaryButton(): Promise<void>
       pressSecondaryButton(): Promise<void>
     }
     ```
   - Access pattern:
     ```typescript
     const extension = vscode.extensions.getExtension("saoudrizwan.claude-dev")
     if (extension) {
       const api: ClineAPI = extension.isActive ? extension.exports : await extension.activate()
     }
     ```

4. **PR 4 — Tools Reference Update** (update `docs/tools-reference/all-cline-tools.mdx`)
   - High impact: users see tools in action but can't look them up
   - No dependencies on other PRs, no `docs.json` change needed
   - Source file: `src/shared/tools.ts` (ClineDefaultTool enum — 27 total values)
   - Currently documented tools (~13): `execute_command`, `read_file`, `write_to_file`, `replace_in_file`, `search_files`, `list_files`, `list_code_definition_names`, `browser_action`, `use_mcp_tool`, `access_mcp_resource`, `ask_followup_question`, `attempt_completion`, `load_mcp_documentation`
   - Tools to ADD (14):
     - `apply_patch` — Apply a unified diff patch to modify files (newer alternative to replace_in_file)
     - `web_search` — Search the web and return results with titles and URLs
     - `web_fetch` — Fetch and analyze content from a URL
     - `new_task` — Create a new sub-task (used by subagents feature)
     - `condense` — Summarize the current conversation to free context space
     - `summarize_task` — Generate a summary of the completed task
     - `focus_chain` — Manage a structured focus chain / TODO list for complex tasks
     - `use_skill` — Load and activate a specialized skill by name
     - `use_subagents` — Run up to 5 parallel in-process subagents for broad exploration
     - `generate_explanation` — Generate AI-powered inline comments explaining git changes
     - `new_rule` — Create a new `.clinerules` file from conversation context
     - `report_bug` — Report a bug or issue
     - `plan_mode_respond` — Respond in Plan mode (conversational planning without tool execution)
     - `act_mode_respond` — Respond in Act mode (internal counterpart to plan_mode_respond)

5. **PR 5 — Explain Changes Feature** (`docs/features/explain-changes.mdx` + `docs.json` update)
   - Medium-high impact: unique differentiating feature
   - No dependencies on other PRs (though PR 4 will also mention this tool)
   - Source files: `src/core/controller/task/explainChanges.ts`, `src/core/slash-commands/index.ts`
   - Invocation: Type `/explain-changes` in the chat input
   - Parameters: `from_ref` (required), `to_ref` (optional, defaults to working directory)
   - Supported git ref formats: commit hashes, branch names, tags, relative refs (`HEAD~1`, `HEAD^`, `origin/main`)
   - Output: Opens a multi-file diff view in VS Code with AI-generated inline comments explaining each change
   - The slash command is registered in `SUPPORTED_DEFAULT_COMMANDS` array in `src/core/slash-commands/index.ts` as `"explain-changes"`
   - The handler creates a `ClineSay` message of type `generate_explanation` which renders in the chat as a status indicator

6. **PR 6 — Context Management Deep-Dive** (`docs/features/context-management.mdx` + `docs.json` update)
   - High impact: context management is the #1 source of user confusion
   - No dependencies on other PRs
   - Source files: `src/core/context/context-management/ContextManager.ts`, `docs/features/auto-compact.mdx`, `docs/model-config/context-windows.mdx`
   - Key technical details to document:
     - What counts toward context: system prompt + conversation history (user/assistant messages) + tool call results + file contents from @-mentions
     - Duplicate file read optimization: `applyContextOptimizations()` detects when the same file is read multiple times and replaces older reads with a notice, saving tokens
     - Truncation strategies: `"none"` (remove all), `"lastTwo"` (keep last 2 message pairs), `"half"` (keep last half), `"quarter"` (keep last quarter)
     - `getNextTruncationRange()` is called with `"half"` for moderate pressure, `"quarter"` for severe pressure
     - Model-specific context windows: 64K (DeepSeek), 128K (most models), 200K (Claude)
     - Auto-compact trigger: `shouldCompactContextWindow()` checks if `totalTokens >= maxAllowedSize` where `maxAllowedSize = contextWindow - bufferTokens` (buffers: 27K-40K depending on model)
     - The `condense` tool allows the model to proactively summarize conversation when it detects context pressure
     - Cross-reference to existing docs: link to `features/auto-compact` and `model-config/context-windows`
