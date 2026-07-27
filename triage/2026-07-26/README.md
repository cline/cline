# Backlog triage — open issues and PRs, 2026-03-26 → 2026-07-26

Scope: every issue and pull request that was **open** on 2026-07-26 and **created within the last four months**, judged against the tip of `main` (`e4091c368`).

`main` is what matters here: the new SDK-based VS Code extension (`apps/vscode`, `claude-dev` 4.0.0), the CLI (`apps/cli`), the hub daemon (`apps/cline-hub`), and the SDK (`sdk/packages/*`). The `legacy-extension` branch — the 3.x build currently on the Marketplace — is explicitly **out of scope**, as is anything that only makes sense for it.

| | Total | Need a human | Closeable now | Already have a fix in flight |
|---|---|---|---|---|
| Issues | 501 | 179 | 259 | 43 |
| PRs | 327 | 117 | 106 | — |

Machine-readable output lives beside this file: `issues.csv` / `issues.json`, `prs.csv` / `prs.json`, `duplicate-clusters.json`. Every row carries a code-grounded `evidence` field naming the file or commit that was checked.

---

## 1. The short version

**The backlog is mostly noise, and the noise has one dominant cause.** The monorepo restructure (`apps/vscode` moved out of repo-root `src/` in `791d23899`, then the SDK migration deleted `core/api/providers/`, `core/assistant-message/`, the prompt renderer and the terminal integration) silently invalidated a large slice of the backlog. 78 open PRs patch files that no longer exist. 44 issues describe defects in code that is gone. None of that was ever communicated, so contributors kept filing against dead paths for months.

**Roughly half of the open PRs need no review at all.** 106 should just be closed, and 76 more are the Cline team's own in-flight work. That leaves 92 worth looking at, and 8 of those are already green and mergeable today.

**The genuinely live bug surface is 124 issues, not 501** — and 43 of them already have a community PR attached that is only waiting on a maintainer's approval. The single highest-leverage action available is not fixing bugs; it is approving work that is already done.

**One security finding needs action this week**, plus two PRs that must be closed unreviewed. Details in §5.

---

## 2. Issues

### 2.1 What the 501 resolved to

| Verdict | Count | Meaning |
|---|---:|---|
| `duplicate` | 80 | Same defect as another open issue |
| `needs-info` | 78 | Real-looking, unreproducible without the reporter |
| `confirmed-by-code` | 76 | Defect is visible in code on `main`; no repro needed to believe it |
| `already-fixed` | 64 | Fixed on `main` after filing; commit cited per row |
| `repro-candidate` | 48 | Plausibly still present; worth reproducing |
| `legacy-only` | 44 | Only affects the retired 3.x extension |
| `feature-request` | 40 | Not a defect |
| `invalid-bogus` | 36 | User error, spam, or unusable |
| `out-of-scope` | 35 | Belongs to `cline/kanban`, `cline/marketplace`, or the JetBrains repo |

**259 issues (52%) can be closed without further investigation** — the duplicate, already-fixed, legacy-only, invalid, and out-of-scope buckets. Each row in `issues.csv` carries the justification.

### 2.2 The live bug surface: 124 issues

Full ranked list in `issues.csv` (filter `verdict` to `confirmed-by-code` or `repro-candidate`). Distribution:

| Area | Count | Character of the cluster |
|---|---:|---|
| `vscode-new` | 58 | Terminal/approval plumbing, MCP lifecycle, webview state |
| `sdk-core` | 21 | Tool contracts, checkpoints, session metadata, MCP timeouts |
| `cli` | 17 | ACP integration, settings persistence, binary portability |
| `sdk-llms` | 16 | Provider option routing, stream handling, model catalogs |
| `sdk-agents` | 4 | Loop bounds, message codec, browser build |
| `hub` | 2 | Log growth, session loss |
| other | 6 | docs, infra, JetBrains |

### 2.3 Duplicate clusters

51 clusters absorb **210 of the 501 issues** (76 hard duplicates, 83 related-but-distinct). Full detail in `duplicate-clusters.json`. The biggest:

| Canonical | Dupes | Related | Cluster |
|---|---:|---:|---|
| #12079 | 14 | 7 | Terminal command completion never signalled — "Skipped" then hangs on "Thinking…" |
| #11660 | 4 | 3 | Token counter reports millions of tokens on OpenAI-compatible endpoints |
| #10135 | 4 | 2 | Claude Code provider fails every request with exit code 1 |
| #10626 | 3 | 2 | Chat webview goes grey/blank while the extension keeps working |
| #10427 | 1 | 9 | Provider model pickers missing recently released models |
| #10514 | 1 | 4 | CLI dies at launch on CPUs without AVX2 |

**#12079 is the single most important issue in the backlog.** Twenty-one reports, one defect. It is the top complaint by a wide margin and it is a first-run experience killer.

### 2.4 Verified by reproduction

These were not judged by reading — they were run. Raw logs are in the PR description of this change; scripts were removed afterwards and `git status` is clean.

| Issue | Result | Evidence |
|---|---|---|
| #10499 — MCP tools execute without approval | **Reproduced** | See §5.1. Runnable test written against the real `AgentRuntime`. |
| #10514 / #11539 — CLI SIGILL without AVX2 | **Reproduced** | The real `cline` binary exits 132 under `qemu-x86_64-static -cpu Nehalem`; a `-baseline` control binary runs fine. All three x64 targets in `apps/cli/script/build.ts` are non-baseline, so Intel Macs and pre-Haswell Windows are affected too — not just the Linux/WSL case reported. |
| #11542 — unbounded agent loop | **Reproduced** | A live CLI turn printed `this.config.maxIterations=undefined`; a real `AgentRuntime` with that value ran 1000 iterations and only stopped when the harness aborted it. |
| #12043 + #12120 — ACP ignores BYOK providers | **Reproduced** | A live ACP `initialize` returned exactly `[{"id":"cline"},{"id":"openai-codex"}]`, and `session/new` failed with `Authentication required` despite valid OpenRouter credentials on disk. |
| #12158 — CLI settings not persisted | **Partially reproduced** | After toggling all four General rows and restarting, only `Auto update` survived. The broken set is exactly Mode, Compaction, Auto-approve-all, and Verbose — not "all settings" as reported. |
| #12108 — unbounded hub log | **Partially reproduced** | `hub-daemon.log` grew 4010 → 5836 bytes with `run.heartbeat` appended every 30s, one file, no rotation. The heartbeat is `clearInterval`ed in a `finally`, so it only grows during an in-flight turn — bounded by stuck turns, not free-running. |
| #10169 — `\x64` eaten from Windows paths | **Reproduced** | The real repair function turns `{"path":"C:\Users\me\proj\x64\Debug\app.exe"}` into `C:Usersmeprojx64Debugapp.exe`. It returns `null` (untouched) for well-formed escaped JSON, so the trigger is specifically *malformed* tool-call JSON. |
| #11793 — `apply_patch` fuzzy matcher | **Partially reproduced** | Real timings: an **8.4 KB / 160-line** file timed out at 30s (40.3s wall, 1761 MB peak RSS). But the scaling is **linear in file length and quadratic in hunk size** — cost is O(hunks × fileLines × hunkChars²), not O(n²) per hunk. A 15 000-line file with a 3-line hunk costs 6.8s. Also, `applyPatchTimeoutMs` bounds nothing: the parser is synchronous, so `withTimeout` cannot fire until the work finishes. |
| #12004 — `content.map is not a function` | **Reproduced** | Thrown from all three unguarded sites. There is a **third** unguarded site the report missed: `cloneMessages` at `agents/src/agent-runtime.ts:295`, upstream of the codec and reachable from `run()`, `restore()`, and `beforeModel` hooks. |
| #11415 — `@cline/agents` browser build | **Reproduced** | Both esbuild and `bun build --target=browser` fail: `No matching export in ".../llms/dist/index.browser.js" for import "createGateway"`. Marking `@cline/llms` external (what the reporter did) succeeds but emits a dangling import resolving to `undefined` — which is why they saw a silent `undefined` rather than a build error. |
| #11750 — CLI exits from a drive-root cwd | **Reproduced** | `path.win32.basename("D:\\") === ""` produces ZodError `too_small` at `["workspaces","D:\\","hint"]`. The failing field is `hint`, not `rootPath`, and the schema is in `shared/src/session/workspace.ts`, not `workspace-manifest.ts`. |
| #11026 — Plan/Act tooltip shows the wrong key | **Reproduced end-to-end in the UI** | See §2.5. |

### 2.5 Corrections to reported or triaged root causes

Being precise about what is *not* true matters as much as the list itself.

- **#12133 ("`git commit --amend` should not be a safe command") is milder than it reads.** The legacy extension had a two-tier control: "Execute safe commands" with a nested "Execute all commands". `main` deliberately collapsed this to a single toggle and the UI label is now the honest "Execute commands" — verified visually in the running extension. Only the internal state key is still misleadingly called `executeSafeCommands`. This is a naming cleanup, not the security hole the title suggests.
- **#11542's premise that VS Code sets `maxIterations` is false.** `apps/vscode/src/sdk/cline-session-factory.ts` explicitly passes `maxIterations: undefined`. Both surfaces are unbounded.
- **#12120 has an undocumented workaround**: setting any non-empty `CLINE_API_KEY` bypasses the gate, after which `CLINE_PROVIDER=openrouter` works. Verified end to end. It works, but the env var name is actively misleading.
- **#11026 is a genuine mismatch, confirmed both ways.** `config/platform-configs.json` sets `"togglePlanActKeys": "Meta+Shift+a"`. `ChatTextArea.tsx:1055` passes that raw string to `useShortcut`, which maps `Meta` → `event.metaKey` (Super on Linux). The tooltip separately renders `.replace("Meta", metaKeyChar)`, printing "Alt" on Linux. In the live extension, Alt+Shift+A does nothing three times running; Super+Shift+A toggles the mode.

---

## 3. Pull requests

### 3.1 What the 327 resolved to

| Verdict | Count |
|---|---:|
| `review-and-merge` | 84 |
| `close-obsolete` | 78 |
| `maintainer-internal` | 76 |
| `needs-author-work` | 53 |
| `close-low-quality` | 22 |
| `merge-ready` | 8 |
| `close-duplicate` | 5 |
| `close-spam` | 1 |

182 of 327 have merge conflicts. Only 2 open PRs target `legacy-extension`, so base branch is not a useful filter — **the useful filter is whether the PR touches paths that still exist**.

### 3.2 Mergeable today (8)

Green CI, no conflicts or trivially rebased, security-clean:

| PR | Author | What |
|---|---|---|
| #12486 | aikido-autofix[bot] | `@grpc/grpc-js` 1.13.3 → 1.14.4, real CVE fix, all 18 checks green |
| #11683 | ken-jo | Corrects the CLI MCP config path in docs (fixes #11671) |
| #12068 | TheStreamCode | Recognize Chutes provider |
| #12041 | mc856 | Drop the dead `claude_code` entry from `PROVIDER_API_KEY_MAP` (fixes #12040) |
| #12154 | CoderSufiyan | Docs: typos, wrong slash command, hooks-vs-plugins mismatch |
| #11752 | yanalialiuk | Docs table addition |
| #11231 | dependabot[bot] | `rand` 0.9.2 → 0.9.4 in the desktop app |
| #10723 | oab24413gmai | Capitalize "GitHub" in the security note |

### 3.3 Worth reviewing (84)

Full list in `prs.csv` (filter `verdict = review-and-merge`), sorted there by reviewer effort. The highest-value ones, all fixing a confirmed issue:

| PR | Effort | Fixes | What |
|---|---|---|---|
| #12405 | trivial | — | Prevent agent commands blocking on pagers |
| #12398 | small | #11542 | Bound the CLI agent loop with a default `maxIterations` |
| #11915 | small | #11793 | Avoid expensive Levenshtein matching for oversized contexts |
| #12357 | small | #12302 | Inherit base-model capabilities for Bedrock custom-ARN tool calling |
| #12050 | small | — | Keep tool-result message ids stable across persist cycles |
| #11790 | small | #11750 | Avoid empty workspace root hints (the drive-root crash) |
| #11421 | small | #11404 | Implement ACP `loadSession`, fixes `-32601` on Zed restart |
| #11312 | small | — | Stable deterministic MCP tool IDs |
| #11338 | trivial | — | Restrict external URI schemes — `openExternal` currently passes any scheme, so a model-supplied `command:` URI is unguarded |
| #12364 | large | — | Harden MCP local settings and secret handling; all CI green |
| #11141 / #11148 | large | — | Serialize Codex OAuth refresh across windows |
| #12541 | small | — | Keep prior compaction summaries frozen in basic compaction |

A note on throughput: **most of these are `blocked` purely on a missing approval, not on any defect.** One contributor (`CoderSufiyan`) authored ten of them in the same disciplined shape — small diff, regression test, honest note about which local checks were blocked.

### 3.4 Close without review (106)

- **78 `close-obsolete`** — patch deleted paths (repo-root `src/`, `webview-ui/`, `proto/`, the retired Ink `cli/`, or `apps/vscode/src/core/api/providers/`), or the fix already landed. Several are genuinely good work that the restructure invalidated: #10556, #10619, #10629, #10632, #10714 are large, well-built, and unmergeable. They deserve a courteous close explaining why, not silence.
- **22 `close-low-quality`** — includes three `eve/delete-*` branches removing shipped features with no linked issue (#10213's own description opens with "(We will not be releasing this.)"), a 401-line wholesale reformat of `vertex.ts` hiding its real change (#10304), and a PR that committed an `implementation_plan.md` containing the author's local paths while quietly removing the auto-approve bar (#10331).
- **5 `close-duplicate`**, **1 `close-spam`**.

### 3.5 Vendor self-promotion

Nine PRs are third-party gateway vendors adding themselves to docs or the provider list, several openly describing themselves as one of many parallel placements. `docs/provider-config/` on `main` has already been pruned to first-party providers, so there is a policy to point at. Worth one canned response and a CONTRIBUTING note.

---

## 4. Repository hygiene problems this exposed

These are the reasons the backlog got into this state. Fixing the backlog without fixing these just regenerates it.

1. **Nothing tells contributors the tree moved.** 78 PRs and 44 issues were filed against deleted paths over four months. `CONTRIBUTING.md` says nothing about the restructure or about `legacy-extension` being retired.
2. **The issue template does not capture the surface reliably.** 324 of 501 issues have no parsable `Cline Surface` field, so "is this the new extension or the 3.x Marketplace build?" has to be inferred by hand every time.
3. **`stale` is applied but never acted on.** 145 issues carry the label; none were closed. The label currently signals nothing.
4. **Review latency, not review capacity, is the bottleneck.** Dozens of small, tested, green-CI community fixes sit at `blocked` waiting for an approval. Contributors are doing the work; the queue is not draining.
5. **CI noise is training everyone to ignore CI.** One flaky case — `interactive/chat.test.ts › closing the help dialog removes its grey panel` — shows up red on at least six unrelated PRs. Also seen: a `grpc-tools` 502 during install, and an aborted download in `e2e (windows)`.
6. **`gh api repos/cline/cline/issues` returns only PRs**, which will silently break any tooling that assumes the REST issues endpoint returns both. Use the GraphQL-backed `gh issue list`.

---

## 5. Security

### 5.1 MCP tool approval fails open (#10499) — fix this first

**This is a real consent bypass in the new extension and it is not theoretical.**

`buildToolPolicies` in `apps/vscode/src/sdk/sdk-tool-policies.ts` enumerates MCP tools **once**, at session start, from `mcpHub.getServers()`. `resolveToolPolicy` in `sdk/packages/agents/src/agent-runtime.ts:129` merges a `"*"` wildcard entry with the per-tool entry — and `buildToolPolicies` never sets `"*"`. The gate at `agent-runtime.ts:1403` then reads:

```ts
} else if (policy.autoApprove === false) {
    const approval = await this.requestToolApproval(toolCall, input, policy);
```

An MCP tool that was not in the map resolves to `{}`, so `policy.autoApprove` is `undefined`, the branch is skipped, and **the tool executes with no approval prompt at all** — regardless of the "Use MCP servers" toggle being off. Any MCP server that connects after the session was created, or any tool added on a server refresh, is in this state.

Reproduced with a runnable test against the real `AgentRuntime`: a tool present at session start correctly prompts and is blocked when denied; an identical tool absent at session start executes with `requestToolApproval` never called.

```
✓ asks for approval for an MCP tool that WAS enumerated at session start
✓ FAIL-OPEN: executes an MCP tool that connected AFTER session start with no approval
```

Smallest correct fix: add `policies["*"] = { autoApprove: false }` in `buildToolPolicies`, so unknown tools default to *requiring* approval and `isToolAutoApproved` remains the single decision point.

### 5.2 Close unreviewed (2)

- **#10735** (`martinfr-certifyos`) — a CertifyOS fork's internal branch opened against upstream by mistake. It renames 13 release workflows (including `publish.yml`, `publish-cli-trusted.yaml`, `npm-main.yaml`) into `.github/workflows-disabled/`, killing the release pipeline; adds `scripts/install-cline-macm4.sh`, which uninstalls the official `saoudrizwan.claude-dev` extension and installs a VSIX from a private GCS bucket; and packages with `vsce package --allow-package-secrets sendgrid`. Close it without review.
- **#11420** (`rodboev`) — titled as a fix, but it reverts the SEC-68 hardening. `createHubAuthToken()` goes from `randomBytes(32).toString("hex")` to returning `""` unless `CLINE_HUB_AUTH_TOKEN` is set, and `isValidHubAuthToken()` is relaxed so an empty expected token accepts an empty candidate. Net effect: the local hub WebSocket daemon accepts unauthenticated connections by default. Reject with an explanation; the underlying usability complaint is worth a separate issue.

### 5.3 Needs a security decision before merge (6)

| PR | Concern |
|---|---|
| #12008 | Turns any `<invoke name="...">` text a model emits into an executed tool call, for **every** provider. That is a direct prompt-injection channel from file or web content the model echoes back. Must be gated to the affected gateways. |
| #12125 | Persists connector launch argv verbatim into `connectors.db` with no redaction. Those argv arrays carry channel credentials — the tests themselves use `['--bot-token', 'xoxb2']` and `['-k', '123:token']`. Not raised in any of its 34 review comments, and it is approved. |
| #11251 | Adds `@agentphone/chat-sdk-adapter@^0.1.0` — brand-new, unpinned caret range — as a runtime dependency of the published CLI, plus an inbound webhook driving a tool-executing agent. Webhook auth itself is done correctly (HMAC + `timingSafeEqual`, fails closed). |
| #11795 | Normalizes model-supplied shell input *inside* `createBashTool.execute`, after hooks and approval have seen the raw payload — so audit sees one opaque string and execution sees a parsed array. Already raised by `arafatkatze` on the PR. |
| #10376 | Genuine hardening of a prompt-injection path in `ClineIgnoreController.validateAccess`, but flips allow-by-default to deny-by-default and would break legitimate out-of-workspace reads. Needs a product call on sandbox semantics. |
| #12522 | Ships a plugin runtime inside the VSIX and makes VS Code execute workspace plugin code. Mitigations are present and deliberate (supervised `ELECTRON_RUN_AS_NODE` child, `buildSubprocessSandboxEnv` strips ten `VSCODE_*` IPC vars), but it is a real expansion of execution surface. Draft, 13 open threads. |

### 5.4 Already shipping, worth a look

PR #10986 tried to revert an LG-CNS webhook integration and can no longer apply — but the code it wanted removed **still ships on `main`** at `apps/vscode/src/services/lg-cns-integration/webhook-hooks.ts`. It writes a webhook URL and token to `Documents/Cline/webhook_config.json`, drops mode-0755 hook scripts, and remains reachable via `SharedUriHandler`. Either the revert should be redone against `apps/vscode` or the feature should be owned deliberately.

Separately, #12469 is confirmed: MCP stdio servers receive the full `process.env`, including every API key in the parent environment.

---

## 6. Plan

Ordered by leverage, not by area. Steps 1–3 are mechanical and can be done by an agent with write access; step 4 onward needs judgement.

### Step 1 — Security (do first, independent of everything else)

- Fix #10499 with the one-line `"*"` policy default plus a regression test.
- Close #10735 and #11420 with explanations.
- Decide #12008, #12125, #11251, #11795, #10376, #12522 — six decisions, not six reviews.
- Own or remove the LG-CNS webhook code.

### Step 2 — Close the dead weight (365 items)

- **259 issues**: duplicates → comment pointing at the canonical and close; already-fixed → cite the commit; legacy-only → explain that the 3.x extension is being retired; out-of-scope → transfer to `cline/kanban`, `cline/marketplace`, or the JetBrains repo.
- **106 PRs**: obsolete → explain that the tree moved and name the new path where one exists, so good contributors can re-target rather than walk away; low-quality/spam → close.

Use `issues.csv` and `prs.csv` as the work queue; every row already carries its justification.

### Step 3 — Drain the approval queue (92 PRs)

Merge the 8 green ones today. Then work `review-and-merge` in effort order — `prs.csv` is already sorted that way. Around 40 are trivial or small, most fixing a confirmed issue, most blocked only on approval. This is the cheapest large win available and it closes 43 issues as a side effect.

Before starting, fix the flaky `interactive/chat.test.ts › closing the help dialog removes its grey panel` case, or CI will keep lying during the merge run.

### Step 4 — Fix the top clusters

In order of reporters affected:

1. **#12079** — terminal completion never signalled (21 reports). Biggest single win in the backlog.
2. **#10514 / #11539** — CLI SIGILL without AVX2. Product is 100% unusable for affected users and the failure mode is a bare `Illegal instruction` because `postinstall.mjs` swallows errors with `process.exit(0)`. Ship `-baseline` targets; two PRs already attempt this (#11412, #12273) with different strategies — pick one.
3. **#10208 / #10631** — no idle or response-start timeout on any provider except Ollama. This likely explains a large share of the recurring "stuck Thinking" reports.
4. **#12043 / #12120** — ACP ignores BYOK providers entirely.
5. **#10626 / #11527** — no root error boundary in the webview, so one bad persisted message blanks the whole panel.

### Step 5 — Stop the backlog regenerating

- Add a "the tree moved" section to `CONTRIBUTING.md`: what lives where on `main`, that `legacy-extension` is retired, and that PRs touching repo-root `src/`, `webview-ui/`, or `proto/` will be closed.
- Make the issue template's surface field required, with `legacy 3.x` / `4.x SDK extension` / `CLI` / `SDK` as explicit options.
- Either wire `stale` to actually close, or drop the label.
- Add a CONTRIBUTING policy on third-party gateway/provider submissions so the vendor PRs get one consistent answer.
- Re-run this triage on a schedule. The pipeline is reproducible from the CSVs.

---

## 7. Method

- Sourced via `gh issue list` (GraphQL) and `gh api repos/cline/cline/pulls`, then enriched per-PR with file lists, mergeability, and CI state.
- Triaged in 35 parallel batches of 25. Every verdict required grounding in code at `/workspace`: locating the symbol, setting key, provider id, or error string on `main`, and checking `git log` for a fix landing after the filing date. Verdicts with no code grounding were not accepted.
- A separate global pass found cross-batch duplicates, since each batch agent only saw its own slice.
- The highest-severity claims were then reproduced by executing code — the CLI, the SDK, and the extension in a real VS Code host — rather than by reading. §2.4 and §2.5 record both what confirmed and what turned out to be wrong.
