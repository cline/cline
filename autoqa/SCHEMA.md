# AutoQA schema reference

All files are YAML. `bun scripts/autoqa.ts validate` enforces this.

## Case file (`cases/<surface>/<feature>.yaml`)

```yaml
feature: ide.checkpoints             # feature id; every case id must start with "<feature>."
title: Checkpoints                   # human name for the feature
docs: [docs/core-workflows/checkpoints.mdx]   # product docs the cases were derived from
cases:
  - id: ide.checkpoints.reset-code-button      # <surface>.<feature>.<behaviour>; unique repo-wide
    title: Reset Code button restores files    # finish the sentence "<title> is broken when …"
    surface: ide                    # ide | cli | desktop | kanban | acp | connectors | cloud | smoke
    hosts: [vscode, jetbrains]      # optional; only for surface: ide. Omit = all IDE hosts.
    platforms: [linux, windows, macos]   # optional; omit = all
    priority: P1                    # P0 smoke | P1 core | P2 feature | P3 edge
    maturity: draft                 # draft | reviewed | trusted
    estimated_minutes: 4
    tags: [checkpoints, chat]       # free-form; matched against .changeset text for recency
    touches:                        # source paths (prefixes ok) → recency scoring via git log
      - apps/vscode/webview-ui/src/components/chat/UserMessage.tsx
      - apps/vscode/src/sdk/sdk-checkpoints.ts
    refs: []                        # e.g. ["cline/cline#14501", "https://github.com/…/pull/123"]
    requires: [std.ide, task.edited-file]   # prereq ids or set ids; ALL must be true
    provides: []                    # prereq ids that become true when this case PASSES
    isolation: fresh-task           # how to retest on failure: none | fresh-task | fresh-window | fresh-profile
    steps:                          # ordered; each item is exactly one of do / expect / capture
      - do: Hover the last user message in the chat …
      - expect: A "Reset Code" button is visible …
      - capture: reset-code-visible   # screenshot name (agent saves to runs/<id>/screenshots/<name>.png)
    notes:                          # optional host/platform-specific hints
      jetbrains: The chat panel is on the right by default; …
      windows: …
    known_issues: []                # refs to open issues; a fail here is "still broken", not new
```

Rules
* `id` unique across all files; must start with the file's `feature` + `.`.
* `steps` non-empty; contains at least one `expect`.
* `requires` ids must exist in `prereqs/prereqs.yaml` (as a prereq or a set).
* `provides` ids must exist as prereqs (not sets).

## Prerequisite catalog (`prereqs/prereqs.yaml`)

```yaml
prereqs:
  - id: provider.working
    title: An inference provider is configured and returns completions
    requires: [account.logged-in]      # optional
    platforms: [linux, windows]        # optional
    surfaces: [ide, cli]               # optional; where this bit is meaningful
    check:
      agent: Send "reply with the single word PONG" … expect PONG in < 60 s.
      command: cline --json -t 60 "reply with the single word PONG" | grep -q PONG   # optional; exit 0 = true
    establish:
      agent: |
        Multi-line micro-skill: how to make this true …
      command: …                       # optional deterministic path
    volatile: true                     # optional; re-check before relying on it (credits, network)
sets:
  - id: std.ide
    title: Typical IDE state
    includes: [ide.open, workspace.open, ide.cline-panel-open, account.logged-in, provider.working]
```

## Run directory (`runs/<run-id>/`)

`run.yaml` — written by `new-run`, hand-edit only `build` and `notes`.
```yaml
id: 2026-09-29-linux-vscode-a
created: 2026-09-29T15:02:11Z
platform: linux                 # linux | windows | macos
host: vscode                    # vscode | jetbrains | cli | desktop | kanban | acp | connectors | cloud
surfaces: [smoke, ide, regressions]   # which surfaces this run may pick from (default: all applicable)
commit: 3f2a9c1                 # cline/autoqa commit the cases were read from
cline_commit: b0a6a45           # cline/cline checkout used for planning signals (if CLINE_REPO exists)
build:                          # what is actually under test — fill in!
  extension: 4.1.21
  cli: 1.2.3
  ide: VS Code 1.104.0
focus: []                       # case ids / tags to boost (from --focus)
notes: ""
```

`state.yaml` — maintained via `autoqa state set <id> true|false [--note …]`.
```yaml
ide.open: { value: true, at: 2026-09-29T15:05:00Z, note: "code --no-sandbox …" }
```

`results.yaml` — append-only list, maintained via `autoqa record`.
```yaml
- case: ide.checkpoints.reset-code-button
  status: fail                  # pass | fail | flaky | blocked | skip
  at: 2026-09-29T15:20:00Z
  duration_minutes: 5
  isolated: false               # true when this record is the isolated retest
  evidence: [screenshots/reset-code-missing.png]
  notes: Button never appeared; checkpoints toggle was ON.
  suspected_interference: ide.settings.checkpoints-toggle   # optional, on flaky
  blocked_on: provider.working  # only for status: blocked
```

`summary.md` — free-form but with these headings so the triage agent can parse it:
`## Bugs to file`, `## Fixes confirmed`, `## Flaky`, `## Blocked`, `## Case feedback`.
