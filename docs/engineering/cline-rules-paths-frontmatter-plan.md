# Cline Rules: YAML `paths` Frontmatter — Implementation Plan

This document proposes a technical design for adding **conditional applicability** to **Cline Rules** using **YAML frontmatter** with a `paths` list (similar in spirit to Claude Code rules).

Scope constraints (explicit):

- ✅ Only plan + design for **Cline Rules** (`~/Documents/Cline/Rules` and workspace `.clinerules{,/}`) and **remote global rules**.
- ✅ Only add **one conditional mechanism**: YAML frontmatter key `paths`.
- ✅ Include matching semantics + prompt-build integration + toggle behavior + tests.
- ❌ Exclude workflows.
- ❌ Exclude hooks.
- ❌ Exclude other conditionals (model/provider/mode/etc.).

---

## 1. Background: Current behavior (baseline)

Today, Cline Rules are concatenated verbatim into the system prompt, with enable/disable determined solely by toggles:

- Global file-based rules: `~/Documents/Cline/Rules/*`
- Workspace rules: `<workspace>/.clinerules` (directory or legacy file)
- Remote rules: `remoteGlobalRules[]` from remote config

The prompt is (re)built for each API request in `Task.attemptApiRequest()` (`src/core/task/index.ts`).

There is **no metadata parsing** for Cline Rules.

---

## 2. Goal

Allow a Cline Rule file to declare YAML frontmatter:

```md
---
paths:
  - "apps/web/**"
  - "packages/*/src/**"
---

<rule body>
```

And only include the rule’s body in the prompt if the current workspace context “matches” one of the declared `paths`.

This is intended as the **minimal on-ramp** to conditional rules.

---

## 3. Proposed rule schema (v1)

### 3.1 Frontmatter

- `paths?: string[]`
  - If omitted or empty → rule applies universally (current behavior).
  - If present → rule applies only when it matches.

### 3.2 Body

- The remainder of the markdown file after frontmatter.

### 3.3 Validation rules

- If YAML frontmatter fails to parse: **fail open** (treat as universal rule) and keep entire file as body.
  - Rationale: this matches existing “fail open” approach in other areas (robustness; avoids silently dropping a rule).

---

## 4. Matching semantics

We need a deterministic and explainable definition of “does this rule apply right now?”

### 4.1 Inputs to matching

We should treat `paths` as a proxy for the implicit condition:

> “When the work you are about to do involves files matching these paths, these expectations apply.”

At the exact moment Cline builds the system prompt (immediately before `api.createMessage(...)`), it does **not** have a perfect, structured representation of what the request “is about.”

So we need a proxy set of **evidence** to determine which paths are relevant for *this request*.

#### Recommended v1 evidence stack

The evidence stack is not prioritized for comparison — we are looking for *any* positive indication that a rule should (in spirit) apply. All sources contribute to a single candidate path set.

1) **Explicit referenced paths (high confidence)**
   - Paths resolved from user mentions (e.g. `@file` / "context mentions" that resolve to workspace files).
   - Paths targeted by tool calls in the immediately preceding turn(s), especially:
     - `read_file`, `write_to_file`, `apply_patch`, `list_files`, `search_files`.

2) **Path-like strings in user message text (medium confidence)**
   - Parse the current user message for path-like patterns (e.g., `apps/web/`, `src/components/Button.tsx`, `packages/*/lib`).
   - This solves the **"first turn" problem**: a user typing "add a new component to apps/web" should activate a rule scoped to `apps/web/**`, even though no file context exists yet.
   - Implementation notes:
     - Use a regex to extract candidates that look like relative paths (contain `/`, no spaces, reasonable file/dir name characters).
     - Validate candidates against actual workspace structure when possible (exists check) to reduce false positives.
     - If validation is too expensive, treat these as low-confidence candidates that still contribute to matching.

3) **Observed workspace context (medium confidence)**
   - **Visible files (open editors)**: Files currently visible in VS Code editor panes.
   - **Open tabs**: All files with open tabs in VS Code (may not be visible but are in the tab bar).
   - **Recently modified files** (scoped definition — see §4.1.1 below).

4) **Fallback (conservative)**
   - If there is no evidence from any source, do **not** activate path-scoped rules.

#### 4.1.1 Defining "recently modified files"

To avoid surprising activations, "recently modified" is **strictly scoped** for v1:

- **Scope**: Files modified **by Cline** (via `write_to_file`, `apply_patch`, or similar tools) **during the current task**.
- **Not included**: Files modified by the user directly, files modified in previous tasks, or files from git history.
- **Rationale**: This keeps the evidence set predictable and directly tied to the current interaction. A rule activating because of a file Cline touched makes sense; a rule activating because of a random git change from yesterday does not.
- **Implementation**: Track tool target paths in `Task` state as tools execute. This list is already partially maintained for checkpoint purposes.

#### 4.1.2 Defining "currently applicable files" (summary)

The **candidate path set** for rule matching is the union of:

| Source | Description | Persistence |
|--------|-------------|-------------|
| `@file` mentions | Resolved paths from explicit user mentions | Current turn |
| Tool targets | Paths from tool calls (`read_file`, `write_to_file`, etc.) | Current task (last N turns, e.g., 3) |
| Path-like text | Parsed from user message prose | Current turn |
| Open tabs | All tabbed files in VS Code | Snapshot at prompt build |
| Visible editors | Currently visible editor panes | Snapshot at prompt build |
| Task-modified files | Files Cline has written during this task | Current task |

All paths are normalized to root-relative POSIX format, deduplicated, and capped (e.g., 100 entries max).

Reasoning:

- This aligns with the “rules are constraints for the work you’re about to do” mental model.
- It is still deterministic and explainable (“it activated because you referenced/edited X”).
- It avoids heavy repo scans or semantic inference.

### 4.2 What paths are matched against

- Use repo-relative paths (relative to `Task.cwd` / primary workspace root).
- Normalize to POSIX-style slashes for glob consistency.

### 4.3 Glob implementation

Use a well-tested glob matcher (recommended):

- `minimatch` OR `picomatch`.

Design notes:

- `.clineignore` already uses gitignore semantics via `ignore` library, but these are *not* the same as globbing. Reusing `ignore` would be confusing.
- `picomatch` is fast and handles common glob syntax; `minimatch` is also common. Either is fine; pick one consistent with existing deps.

### 4.4 Match rule

A rule with `paths` applies if:

- Any candidate “context path” matches any pattern in `paths`.

Edge cases:

- If no candidate paths exist (no tabs/visible/recently modified):
  - Option A (recommended): **do not activate path-scoped rules** (conservative).
  - Option B: activate path-scoped rules if pattern is `**` or `/`-equivalent.

Recommendation: Option A.

Rationale: Otherwise path-based conditionals become “randomly always on” early in a task before any file context exists.

### 4.5 Multi-root workspaces

We should be compatible with both single-root and multi-root workspaces.

In multi-root workspaces, the simplest mental model is:

> “A `paths` pattern is evaluated against the file’s path **within whatever workspace root it belongs to**.”

So we do **not** need separate matching logic; we just need to make sure we generate candidate paths from *all* workspace roots.

#### Proposed v1 approach (root-agnostic matching)

1) Build a candidate list of **repo-relative paths per root**
   - For every evidence path (mentions/tool targets/visible/open/recent), compute:
     - `relPath = path.relative(rootPath, absolutePath)` for the root that contains it
   - Normalize `relPath` to POSIX.

2) Match frontmatter `paths[]` globs against `relPath`.

3) A rule applies if **any** candidate `relPath` matches.

This yields the intuitive outcome we want:

- A rule with `paths: ["apps/web/**"]` activates when the request context includes any file under `apps/web/` in *any* workspace root.

#### Implementation note

Even with “root-agnostic matching”, we still need to know which root a path belongs to in order to compute `relPath` correctly. But this can be an internal detail of the candidate-generation step; the matcher can remain purely `glob(pattern) vs relPath`.

---

## 4.6 Prompt-build timing and what we can know

This is critical context for why the evidence stack exists.

Prompt building happens for each request in `Task.attemptApiRequest()` and occurs *just before* calling the model provider (`api.createMessage(systemPrompt, ...)`).

At that moment we have:

- The **current request’s userContent** (already constructed in `recursivelyMakeClineRequests`).
- The **conversation history**.
- The **environment details** we choose to inject.

We do *not* have:

- A reliable, structured “intent” object describing which files will be touched next.

Therefore, path-scoped rules must be driven by observable evidence (mentions/tool targets/UI context) rather than by perfect prediction.

## 5. Data flow design

### 5.1 Parse frontmatter (shared utility)

We already have frontmatter parsing in `src/core/context/instructions/user-instructions/skills.ts`:

- Regex-based extraction
- `js-yaml` parsing
- Fail-open fallback

Plan:

- Extract this into a reusable helper module, e.g.:
  - `src/core/context/instructions/user-instructions/frontmatter.ts`

Proposed API:

```ts
export type FrontmatterParseResult = {
  data: Record<string, unknown>
  body: string
  hadFrontmatter: boolean
  parseError?: string
}

export function parseYamlFrontmatter(markdown: string): FrontmatterParseResult
```

Then:

- Update `skills.ts` to use this helper (non-functional change).
- Use the same helper for rule parsing.

### 5.2 Extend rule loading to include metadata

Currently, `getRuleFilesTotalContent()` reads files and concatenates as:

```ts
`${relativePath}\n` + file.trim()
```

We will extend this to:

1) Read file
2) Parse frontmatter
3) Decide applicability
4) If applicable, include **body only** (not frontmatter) in the prompt.

### 5.3 Where applicability is decided

There are two viable insertion points:

#### Option 1 (recommended): Decide applicability inside `getRuleFilesTotalContent()`

Pros:

- Centralizes rule file reading + concatenation.
- Keeps `cline-rules.ts` orchestration simple.

Cons:

- Needs additional input: context paths and/or a matcher.

Implementation:

```ts
getRuleFilesTotalContent(
  ruleFilePaths: string[],
  basePath: string,
  toggles: ClineRulesToggles,
  opts?: { pathContext?: string[]; matchRulePaths?: (paths: string[]|undefined)=>boolean }
)
```

#### Option 2: Decide applicability in `getGlobalClineRules()` and `getLocalClineRules()`

Pros:

- More explicit; no signature change on helper.

Cons:

- Duplicates logic between global and local.

Recommendation: Option 1.

### 5.4 Getting “path context” into the prompt-build step

At prompt build time (`Task.attemptApiRequest()`), we should compute a **candidate path set** using the evidence stack from §4.1.

We add a helper in `Task` that returns a bounded, normalized list of **root-relative paths**.

```ts
private getRulePathContext(): string[]
```

In multi-root, this list is still `string[]`, but each entry is computed as a `relPath` relative to the root that contains that file.

#### v1 rules for building the context list

1) Include **explicit referenced paths** when available
   - Best source: mention parsing already resolves files; we should plumb those resolved paths into a structured list.
   - Additionally, record tool target paths as part of task state (or extract them from recent tool executions) so they can influence the next prompt build.

2) Include **observed UI/workspace context**
   - visible/open/recently modified

3) Normalize and bound
   - convert all to root-relative paths (for each path, pick its containing root)
   - convert to POSIX
   - de-duplicate and sort for determinism
   - cap to N entries (e.g. 50)

Then pass `pathContext` into rule loader calls so the loader can decide applicability.

---

## 6. Behavior with toggles

Toggles remain the primary user control.

- If a rule is toggled off → it is not included, regardless of `paths`.
- If toggled on:
  - If no `paths` → include.
  - If `paths` → include only if applicable.

UI will still show the rule as "enabled" because the toggle is enabled, but it may not be active due to path mismatch.

### 6.1 UI notification for conditional rule activation

When a path-scoped rule is included in the current API request, the user should be informed. This provides transparency and helps users understand why certain behaviors or constraints are being applied.

#### v1 approach: Simple in-chat notification

Display a brief, non-intrusive message in the webview-ui task flow when conditional rules are activated. This appears as part of the API request context (similar to how we show environment details or context mentions).

**Proposed UX:**

- When one or more path-scoped rules activate, show a collapsible/expandable notice in the chat UI.
- Format:
  ```
  📋 Conditional rules applied: [rule-name-1], [rule-name-2]
  ```
- Clicking/expanding could show which paths triggered each rule (optional for v1).

**Implementation notes:**

- The rule loader already knows which rules were included and which were filtered out.
- Return metadata from `getRuleFilesTotalContent()` indicating which path-scoped rules matched:
  ```ts
  type RuleLoadResult = {
    content: string
    activatedPathRules: Array<{ name: string; matchedPaths: string[] }>
  }
  ```
- Pass this metadata back to the Task, which can emit a `say("conditional_rules_applied", ...)` message to the webview.
- The webview renders this as a subtle informational block in the chat stream.

**Why this matters:**

- Users will otherwise be confused when behavior differs based on what files they're working with.
- Debugging rule issues becomes much easier: "Oh, my `frontend-conventions` rule activated because I mentioned `apps/web/`."
- Builds trust in the conditional system — users can see it working.

### 6.2 Future UI considerations (out of scope for v1)

- "Inactive" indicator in rules list when a rule is toggled on but path-filtered out
- Hover tooltip showing which paths a rule would match
- Quick action to "always include" a path-scoped rule for this task

---

## 7. Remote rules (`remoteGlobalRules`) and `paths`

Remote rules are appended in `getGlobalClineRules()` as `rule.contents`.

We need to support frontmatter in `contents` as well, because enterprises will likely want the same conditional power.

Plan:

- Treat `rule.contents` as a markdown file body that *may* contain YAML frontmatter.
- Parse it with `parseYamlFrontmatter`.
- Apply the same `paths` semantics.

**Important:** `remoteGlobalRules` currently are not prefixed with a file path, only `rule.name`.

We will keep that behavior: `name` functions as the “identifier header” in the combined instruction blob.

---

## 8. Prompt formatting & debuggability

To preserve debuggability, we should ensure the prompt still indicates which rule produced which text.

Current file-based formatting uses:

```
relative/path/to/rule.md
<full file content>
```

After this change, it becomes:

```
relative/path/to/rule.md
<body only (frontmatter removed)>
```

For path-scoped rules, it may be helpful to optionally include a short “(paths matched)” note, but that’s extra prompt tokens.

Recommendation for v1: do not add notes.

---

## 9. Testing plan

We need confidence in:

1) YAML parsing correctness
2) Matching semantics
3) No regressions for rules without frontmatter
4) Remote rules handling

### 9.1 Unit tests

Add tests for new helper `parseYamlFrontmatter`:

- no frontmatter → `data={}`, `body=original`
- valid frontmatter with `paths` list
- malformed YAML → fail open
- frontmatter with non-array paths → ignore `paths` (treat as universal)

Add tests for path matching helper:

- exact file match
- glob match (`**`, `*`)
- windows path normalization (ensure posix conversion)
- empty context paths: path-scoped rules inactive

Add tests for `extractPathLikeStrings`:

- extracts paths with `/` separators (e.g., `src/components/Button.tsx`)
- extracts directory paths (e.g., `apps/web/`)
- ignores URLs (e.g., `https://example.com/path`)
- ignores paths with spaces or invalid characters
- handles mixed prose with multiple path candidates
- validates against workspace structure when feasible
- respects deduplication and capping

### 9.2 Integration-ish tests for rule loading

For `getLocalClineRules` / `getGlobalClineRules` (in `cline-rules.ts`):

- create temp workspace with `.clinerules/` and 2 files:
  - one universal
  - one with paths
- set context paths list and verify only correct rule included

Remote rules:

- simulate `remoteGlobalRules` with a `contents` that has frontmatter
- verify inclusion/exclusion based on context paths + `remoteRulesToggles`

---

## 10. Implementation steps (sequenced)

1) **Add shared frontmatter parser**
   - new `frontmatter.ts`
   - reuse regex+js-yaml approach from `skills.ts`

2) **Refactor skills** to use shared parser (no behavior changes)

3) **Add path matching utility**
   - pick glob library (prefer `picomatch` or `minimatch`)
   - implement `doesRuleApply(pathsFrontmatter, contextPaths)`

4) **Add path-like string extraction utility**
   - implement `extractPathLikeStrings(text: string): string[]`
   - regex-based extraction for path-like patterns in prose
   - optional: validation against workspace structure

5) **Thread path context into prompt build**
   - add `Task.getRulePathContext()`
   - implement evidence gathering from all sources:
     - `@file` mentions (from mention parsing)
     - tool target paths (from task state)
     - path-like strings in user message (new utility)
     - open tabs / visible editors (VS Code API)
     - task-modified files (from checkpoint/tool tracking)
   - normalize, dedupe, and cap at 100 entries

6) **Update rule concatenation with metadata return**
   - extend `getRuleFilesTotalContent` to parse frontmatter + filter by `paths`
   - return `RuleLoadResult` with `activatedPathRules` metadata
   - update `getGlobalClineRules` for remote rule contents similarly

7) **Add UI notification for activated conditional rules**
   - add new `say` message type: `"conditional_rules_applied"`
   - emit notification from Task when path-scoped rules activate
   - render notification in webview-ui chat stream (collapsible)

8) **Add tests**
   - unit tests for frontmatter parsing
   - unit tests for path-like string extraction
   - unit tests for path matching (globs, edge cases)
   - integration tests for rule loading with context paths
   - remote rules tests

9) **Docs**
   - add/update docs.cline.bot content later (out of scope)
   - for repo: update any local documentation describing `.clinerules` format

---

## 11. Risks & mitigations

### Risk: nondeterministic “context paths”
If we base matching on visible/open/recent files, rule activation could vary between runs.

Mitigation:

- Use a stable, deterministic set (sorted + deduped).
- Keep the rule inactive if there is zero context.

### Risk: token bloat
If we include too many paths or add verbose debug text.

Mitigation:

- Cap context paths and do not include debug notes in prompt.

### Risk: performance overhead
Parsing YAML for every rule every request could be expensive.

Mitigation:

- Cache parsed frontmatter per file path + mtime (future optimization).
- For v1, keep it simple; rule counts are typically small.

---

## 12. Acceptance criteria

### Core functionality
- A rule file with `paths` frontmatter is only included when it matches the current path context.
- Rules without `paths` behave exactly as before.
- Malformed YAML does not break prompt building (fail open).
- Remote rules can also include `paths` and behave consistently.

### Evidence stack
- Path context is gathered from all defined sources: `@file` mentions, tool targets, path-like strings in user message, open tabs, visible editors, and task-modified files.
- Path-like strings in user message prose are parsed and contribute to matching (solves first-turn problem).
- "Recently modified files" only includes files Cline has written during the current task.
- All paths are normalized to root-relative POSIX format, deduplicated, and capped.

### User visibility
- When path-scoped rules activate, a notification is displayed in the webview-ui chat stream.
- The notification identifies which conditional rules were applied.

### Quality
- All new logic is covered by tests.
- Performance remains acceptable for typical rule counts (< 50 rules).
