# Implementation Plan

[Overview]
Polish and tighten every code example across the docs/ folder.

This plan covers four categories of improvements across ~90 MDX documentation files: (1) adding proper language tags to all fenced code blocks, (2) replacing vague placeholder examples with realistic, useful code, (3) deduplicating content where pages substantially overlap, and (4) updating stale model references to current models. The goal is consistency with the style guide in `docs/contributing/documentation-guide.mdx` which states "Use code blocks with language tags" and "Show Real Examples."

[Types]
No type system changes — this is a documentation-only effort.

N/A

[Files]
All changes are to `.mdx` files in the `docs/` directory. No source code files are modified.

### Category 1: Code blocks missing language tags

These files have fenced code blocks (triple-backtick) without a language identifier. Each bare block needs an appropriate tag added (`text`, `bash`, `json`, `xml`, `markdown`, `typescript`, `python`, etc.). Prompt-style examples that show what a user would type into the Cline chat should use `text`.

**Files to modify (bare code blocks → add language tags):**

1. `docs/core-workflows/working-with-files.mdx` — ~10 bare blocks showing prompt examples → `text`
2. `docs/tools-reference/browser-automation.mdx` — 5 bare blocks (prompt examples) → `text`
3. `docs/tools-reference/all-cline-tools.mdx` — 3 bare blocks (prompt examples in "Common Task Patterns") → `text`
4. `docs/features/at-mentions/overview.mdx` — 1 bare block (combined mentions example) → `text`
5. `docs/features/at-mentions/file-mentions.mdx` — 2 bare blocks → `text`
6. `docs/features/at-mentions/folder-mentions.mdx` — 2 bare blocks → `text`
7. `docs/features/at-mentions/problem-mentions.mdx` — 2 bare blocks → `text`
8. `docs/features/at-mentions/terminal-mentions.mdx` — 2 bare blocks → `text`
9. `docs/features/at-mentions/git-mentions.mdx` — 4 bare blocks → `text`
10. `docs/features/at-mentions/url-mentions.mdx` — 2 bare blocks → `text`
11. `docs/features/multiroot-workspace.mdx` — 6 bare blocks (natural language refs, clineignore example, prompt examples) → `text`
12. `docs/features/slash-commands/explain-changes.mdx` — ~12 bare blocks (command examples) → `text`
13. `docs/features/focus-chain.mdx` — 1 bare block (markdown checklist) → `markdown`
14. `docs/features/tasks/understanding-tasks.mdx` — 4 bare blocks (prompt examples) → `text`
15. `docs/getting-started/quick-start.mdx` — 2 bare blocks (prompt examples) → `text`
16. `docs/getting-started/your-first-project.mdx` — 4 bare blocks (prompt examples) → `text`
17. `docs/customization/cline-rules.mdx` — Verify all code blocks have tags; some YAML frontmatter examples may need `yaml` tag
18. `docs/customization/hooks.mdx` — Verify the inline JSON examples have `json` tags
19. `docs/mcp/adding-mcp-servers-from-github.mdx` — 1 bare block (example interaction) → `text`
20. `docs/exploring-clines-tools/remote-browser-support.mdx` — 3 bare blocks (example workflows) → `text`
21. `docs/exploring-clines-tools/cline-tools-guide.mdx` — 4 bare blocks (common tasks section, missing language tags) → `text`
22. `docs/prompting/prompt-engineering-guide.mdx` — Multiple bare blocks (prompt examples) → `text`
23. `docs/getting-started/authorizing-with-cline.mdx` — Verify all blocks have tags
24. `docs/cline-cli/interactive-mode.mdx` — Check for bare blocks
25. `docs/cline-cli/overview.mdx` — Check for bare blocks
26. `docs/cline-cli/cli-reference.mdx` — Check for bare blocks
27. `docs/cline-cli/three-core-flows.mdx` — Check for bare blocks
28. `docs/cline-cli/samples/github-integration.mdx` — Check for bare blocks
29. `docs/cline-cli/samples/worktree-workflows.mdx` — Check for bare blocks
30. `docs/cline-cli/samples/github-issue-rca.mdx` — Check for bare blocks
31. `docs/cline-cli/samples/model-orchestration.mdx` — Check for bare blocks
32. `docs/cline-cli/samples/github-pr-review.mdx` — Check for bare blocks
33. `docs/cline-cli/getting-started.mdx` — Check for bare blocks
34. `docs/cline-cli/installation.mdx` — Check for bare blocks
35. `docs/cline-cli/acp-editor-integrations.mdx` — Check for bare blocks

### Category 2: Placeholder / vague examples to flesh out

1. `docs/tools-reference/all-cline-tools.mdx` — `write_to_file` example has `// Header component code` placeholder. Replace with a realistic 5-10 line React component.
2. `docs/exploring-clines-tools/cline-tools-guide.mdx` — Same `// Header component code` placeholder in the `write_to_file` example. Replace identically.
3. `docs/exploring-clines-tools/remote-browser-support.mdx` — Example workflows use `javascript` language tag but contain plain English prompts (not JS code). Change to `text`.
4. `docs/customization/workflows.mdx` — The line "Make a full review of the skills documentation." appears as stray text before the "Natural Language" code block. Remove or integrate it properly.
5. `docs/features/slash-commands/workflows/quickstart.mdx` — The `PR_NUMBER` placeholder in the workflow steps could benefit from a note about it being a template variable (already has a Note, but verify clarity).
6. `docs/mcp/mcp-server-development-protocol.mdx` — Large code examples are comprehensive; verify all have proper language tags. The `.clinerules` example uses nested triple-backtick fences—verify they render correctly.
7. `docs/customization/skills.mdx` — The data analysis example's Python code block uses bare indentation inside a markdown body; ensure it has a `python` language tag.
8. `docs/features/skills.mdx` — Same data analysis skill example; the Python block inside the markdown body may lack a tag.

### Category 3: Deduplicate overlapping content

1. **`docs/prompting/prompt-engineering-guide.mdx`** — The ".clineignore File Guide" section at the top duplicates `docs/customization/clineignore.mdx`. Replace the duplicated section with a short cross-reference link: "For `.clineignore` configuration, see [.clineignore](/customization/clineignore)."

2. **`docs/prompting/cline-memory-bank.mdx`** — This file is ~90% identical to `docs/features/memory-bank.mdx`. The features version is more up-to-date (references slash commands, auto-compact, checkpoints). Replace the bulk of the prompting version with a brief intro paragraph and a prominent link to the canonical page: "For complete Memory Bank documentation, see [Memory Bank](/features/memory-bank)." Keep the copy-paste custom instructions block since that's this page's unique value.

3. **`docs/archive/prompt-engineering-guide.mdx`** and **`docs/archive/understanding-context-management.mdx`** — These are archived versions. Leave them as-is (they're in `archive/`).

### Category 4: Stale model references

1. **`docs/prompting/understanding-context-management.mdx`** — The "Token Limits by Model" table references "Claude 3.5 Sonnet", "Claude 3.5 Haiku", "GPT-4o", "Gemini 2.0 Flash", "DeepSeek v3", "Qwen 2.5 Coder". Update to match the models in `docs/model-config/context-windows.mdx`: "Claude Sonnet 4.5", "GPT-5", "Gemini 2.5 Pro", "DeepSeek V3", "Qwen3 Coder". Remove Haiku row if no equivalent exists in the current reference, or replace with a current model.

2. **`docs/prompting/understanding-context-management.mdx`** — The "Next Steps" card links to `/features/cline-rules` which doesn't exist (should be `/customization/cline-rules`). Fix the link.

[Functions]
No function changes — documentation only.

N/A

[Classes]
No class changes — documentation only.

N/A

[Dependencies]
No dependency changes — documentation only.

N/A

[Testing]
Verify documentation renders correctly.

After making all changes:
1. Run `cd docs && npm run dev` to start the Mintlify dev server
2. Spot-check pages that were modified to ensure:
   - Code blocks render with syntax highlighting (language tags are recognized)
   - No broken markdown (unclosed fences, stray text)
   - Cross-reference links resolve correctly
   - No visual regressions in page layout
3. Run a grep to verify no bare triple-backtick blocks remain: `grep -Pn '^\x60\x60\x60$' docs/**/*.mdx` (blocks with only ``` and no language tag)

[Implementation Order]
Execute changes in batches organized by category to minimize merge conflicts and ensure clean diffs.

1. **Batch 1 — Language tags for at-mentions files (6 files):** `file-mentions.mdx`, `folder-mentions.mdx`, `problem-mentions.mdx`, `terminal-mentions.mdx`, `git-mentions.mdx`, `url-mentions.mdx`, `overview.mdx`
2. **Batch 2 — Language tags for core-workflows, tools-reference, features/slash-commands, features/tasks, features/focus-chain (8 files):** `working-with-files.mdx`, `browser-automation.mdx`, `all-cline-tools.mdx`, `explain-changes.mdx`, `understanding-tasks.mdx`, `focus-chain.mdx`, `multiroot-workspace.mdx`, `quick-start.mdx`
3. **Batch 3 — Language tags for getting-started, exploring-clines-tools, mcp, customization (8 files):** `your-first-project.mdx`, `remote-browser-support.mdx`, `cline-tools-guide.mdx`, `adding-mcp-servers-from-github.mdx`, `cline-rules.mdx`, `hooks.mdx`, `skills.mdx` (both copies), `authorizing-with-cline.mdx`
4. **Batch 4 — Language tags for cline-cli files (~12 files):** Scan and fix all CLI documentation files
5. **Batch 5 — Language tags for prompting, enterprise, provider-config files:** Scan and fix remaining files
6. **Batch 6 — Placeholder examples:** Replace `// Header component code` placeholders in `all-cline-tools.mdx` and `cline-tools-guide.mdx`; fix `javascript` tag on prompt examples in `remote-browser-support.mdx`; fix stray line in `workflows.mdx`; verify skill example Python blocks have tags
7. **Batch 7 — Deduplication:** Trim `prompting/prompt-engineering-guide.mdx` .clineignore section; trim `prompting/cline-memory-bank.mdx` to intro + custom instructions + link
8. **Batch 8 — Stale model references:** Update model table in `prompting/understanding-context-management.mdx`; fix broken `/features/cline-rules` link
9. **Batch 9 — Verification:** Run grep for remaining bare blocks; start Mintlify dev server and spot-check
