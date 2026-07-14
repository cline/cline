# AI-Hydro (extension) — Decisions (ADR-style)

Append-only. Newest first. One entry per non-obvious choice, with the **why**.

---

## 2026-07-08 — Cline-fork sync cadence: quarterly batches + a security fast-path

**Context.** AI-Hydro's VS Code extension is a fork of Cline. `UPSTREAM_SYNC.md`
tracks a 48-minor-release gap (v3.34 fork point → v3.82 at time of the last
triage) — a growing, permanent tax: upstream security fixes (action-injection,
dependency CVEs, secrets-file permissions) arrive on this fork's timeline, not
Cline's, until someone manually ports them. Two batches have been ported so
far (Batch 1 + Batch 2, commit `592293271` et al., **2026-05-10**) — 16 items
across OOM fixes, tool-call robustness, and 3 named security fixes (action
injection, secrets.json permissions, plus the dependency/yaml items called out
in the "Priority Port List" below). No sync has landed since; per
`UPSTREAM_SYNC.md`'s own conflict-heatmap, remaining bucket-A items include a
17-CVE dependency bump (v3.62.0) that has NOT been confirmed ported — this
needs re-verification at the next sync (see Follow-up below), not assumed done.

**Decision: quarterly sync batches, with an explicit security fast-path.**
- **Quarterly:** review `UPSTREAM_SYNC.md`'s bucket A/B classification against
  the then-current Cline release, re-run the conflict-heatmap exercise for
  anything new, and port a batch — prioritized by the existing "Priority Port
  List" ordering (security > robustness > UX). Each batch gets its own
  `UPSTREAM_SYNC.md` entry with commit SHAs, matching the Batch 1/2 format.
- **Fast-path:** a security-shaped upstream fix (CVE, credential handling,
  injection, auth) is not deferred to the next quarterly window — it's
  triaged and ported (or explicitly deferred with a stated reason) within the
  same week it's identified, independent of the quarterly cadence.
- **Next scheduled sync: 2026-08-10** (3 months from the last batch). Whoever
  picks this up should first **re-verify** which "Priority Port List" items
  are actually still outstanding — the list as of 2026-07-08 was not updated
  after Batch 1/2 landed, so some entries (e.g. items 3 and 9, which overlap
  with already-ported Batch-1 fixes) may already be done and just need the
  list corrected, not re-ported.

**Alternative rejected: freeze the fork.** Considered accepting permanent
divergence and stopping upstream sync entirely. Rejected because the fork
still receives real security value from Cline's much larger contributor base
(dependency CVE fixes alone justify staying connected), and the existing
conflict-heatmap analysis (`UPSTREAM_SYNC.md`) is a sunk-cost asset that a
freeze would waste — it already maps exactly where future ports will
conflict (`webview-ui/src/components/chat/`, `src/core/task/`,
`src/core/prompts/`, `src/core/mcp/` are named as high-conflict zones).

**Why this isn't a bigger, formal process:** a fixed cadence with a named
next date is enough structure to prevent indefinite drift (the actual
problem — 2 months already elapsed with no tracked next step) without
inventing process overhead for a single-maintainer fork.

**Follow-up (not done here, tracked in `audits/STATUS.md` N-16 at the
AI-Hydro ecosystem root):** verify whether v3.62.0's 17 dependency-
vulnerability fixes actually landed — `UPSTREAM_SYNC.md`'s Batch 1/2 lists
don't mention it despite the Priority Port List citing it as still
outstanding. Spot check done here: `package.json` has `axios@^1.12.0` (a
recent major version, plausibly already past the CVE window), but
`body-parser`/`qs`/`tar` don't appear as direct dependencies — they may be
transitive (would need a `package-lock.json` / `npm audit` pass, not done in
this session, to confirm). Treat this as unverified, not resolved.
