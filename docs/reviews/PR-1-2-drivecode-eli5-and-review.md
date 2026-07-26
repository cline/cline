# PR #1 & #2 review — Drivecode plans, wireframes, and early UI

**Audience.** Humans or agents opening these drafts cold.  
**Sources.** [#1](https://github.com/hhalperin/cline-drivecode/pull/1) · [#2](https://github.com/hhalperin/cline-drivecode/pull/2)  
**Verdict.** Prefer merging **PR #2**. It is a strict superset of PR #1.

---

## ELI5 (start here)

### What is Drivecode?

Imagine coding with a friend on a video call.

- You are in a **room**.
- Your friend (an AI) sits in the **roster**.
- They **share their work** on a **stage** (not a camera of their screen — cards for edits, tests, and decisions).
- You can **talk to one friend, many friends, or everyone**.
- You can **raise your hand** to interrupt.
- You can **leave** without the room disappearing.

That call-shaped product, inside Cline, is **Drive**. The planning + early UI for it is what these PRs land.

### What is a Driveagent?

A Driveagent is an AI coworker with a **folder of papers about themselves**:

- who they are
- what they are good at
- what cases they have done
- what they refuse to do

That folder is `.driveagent/<name>/`. Recruit means “find who fits this job” by reading those papers. A **RosterPack** is a saved seating chart (your cybersecurity crew), not a Cline runtime “Team.”

### What do these PRs actually ship?

Mostly **plans and pictures**, plus a **tiny pretend call UI**.

| Layer | Status in the PRs |
|---|---|
| Product vision / workflows / features | Written |
| Agent home + knowledge graph (PRD/ARDs) | Written, decisions still **Proposed** |
| Interactive HTML wireframes | Written |
| Hub “Join call” chrome + CLI hotkey | Scaffold only |
| Real room server / `@cline/drive` kernel / recruit | **Not built** |

### ELI5 of the architecture

```text
You (webview or CLI)
        │  watch events, send joins/mutes/addresses
        ▼
Hub (one boss on port 25463)
        │  only place that edits the room
        ▼
Drive kernel (@cline/drive) — rules for “call mode”
        │
        ▼
Normal Cline agent turn (same engines as Chat)
```

Three verbs:

1. **Harness proposes** (policies / next move).
2. **Host commits** (hub writes room state).
3. **Apps project** (UI draws events).

### ELI5 of privacy

The call does **not** secretly keep a diary.

- No auto-saving voice or chat into agent memory.
- If the agent wants to “learn” something, it must **ask**, and a human must **accept**.
- That rule is ARD-0004.

### ELI5 of PR #1 vs PR #2

- **PR #1** = the big plan dump + early UI.
- **PR #2** = the same dump, plus a front-door handoff file (`docs/plans/HANDOFF-drivecode.md`) and a slightly updated decision trail.

If you only open one: open **PR #2**.

---

## PR comparison

| | [#1](https://github.com/hhalperin/cline-drivecode/pull/1) | [#2](https://github.com/hhalperin/cline-drivecode/pull/2) |
|---|---|---|
| Branch | `docs/drivecode-drivemode-portfolio-handoff` | `docs/drivecode-handoff` |
| Title | drivemode plans, Driveagent portfolio PRD/ARDs, handoff | handoff plans, wireframes, and Drive UI scaffold |
| Base | `main` | `main` |
| State | Draft | Draft |
| Rough size | ~8.1k additions / 90 files | Same base + 1 new handoff file + small README/decision edits |
| Commits | `c6d7d38` | `c6d7d38` → `668358c` → `c29ad3d` |
| Extra vs #1 | — | `docs/plans/HANDOFF-drivecode.md`, README pointers, `decisions.tsv` trail update |

**Relationship.** PR #2 is built on top of PR #1’s commit. Files only in #2: `docs/plans/HANDOFF-drivecode.md`. Files only in #1: none.

**Merge recommendation.** Merge **#2** (or close #1 as superseded after #2 lands). Keeping both open doubles review load for almost the same diff.

---

## What landed (catalog)

### A. Product plan — `docs/plans/cline-drivemode/`

| Area | Paths | Role |
|---|---|---|
| Index / runbooks | `README.md`, `AGENT-RUNBOOK.md`, `TASK-GRAPH.md`, `HANDOFF.md` | How to navigate and resume |
| Vision → platform | `00-vision.md` … `06-platform-config.md` | North star, architecture D1–D7, research, 39 workflows, 34-facet config |
| Feature specs | `features/DRV-*.md` (~35) | One checklistable unit per capability |
| PRD 6 | `prd/prd-driveagent-portfolio.md` | Portfolio / graph / recruit product requirements |
| ARDs | `ard/ARD-0001` … `0004` | Proposed architecture decisions |
| Example home | `examples/driveagent-pair-partner/` | Concrete `.driveagent` fixture + sample graph |

**Phases (from TASK-GRAPH).**

| Phase | Theme | Built in these PRs? |
|---|---|---|
| 0 | Events, kernel, hooks, privacy, platform config | Plans only |
| 1 | Drive tab, room MVP, roster, persona, leave | UI scaffold only (not hub rooms) |
| 2 | Stage, share, address, packs, steer, interrupt | Plans + wireframes |
| 3 | Mic / TTS / captions | Plans only |
| 4 | CLI parity + optional specialist team flag | CLI chrome stub only |
| 5 | Multi-user design review | Doc only |

### B. Sibling SDK plan — `docs/plans/drivecode-sdk/`

Omnigent-inspired **meta-harness** planning. Key conclusion already recorded:

> **`drivecode-sdk` and `@cline/drive` are the same package.**  
> Grow the planned kernel with a host port + capability descriptor + conformance kit. Do not invent a parallel runtime or a second repo for phase 1.

Reading order: problem/scope → architecture → phased plan → relationship doc. Discovery/Omnigent is evidence, not the entry point.

### C. Design — `docs/design/drive-wireframes/`

| Asset | Role |
|---|---|
| `DRIVE-TAB.md` | Discord IA inside Slack-like chrome (locked recommendation) |
| `drive-tab-discord-slack.html` | Primary interactive prototype |
| `CLINE-BRAND-TOKENS.md` | Tokens measured from cline.bot |
| `index.html` + `variant-*.png` | Earlier Chat variants (marked superseded where needed) |

**UX rule.** Drive tab is home. Chat **Join call** is a shortcut into the active room.

### D. Early implementation (scaffold, not production)

| Surface | What changed |
|---|---|
| Hub webview | `drive/types.ts`, `DriveCallChrome.tsx`, Chat wiring for local Drive UI state + persona hint |
| CLI TUI | Status-bar Drive fields, `Ctrl+Shift+D`, help dialog, session context |

**Still missing (called out in handoffs).**

- `@cline/drive` package
- Hub-owned Drive rooms / reconnect convergence
- Drive tab route (true IA, not Chat-header-only)
- `.driveagent/` loader + compile
- Recruit + RosterPack seating + participant sheet

---

## Detailed concept map

### Domain shape (locked in vision)

```text
DriveTab
  Workspace
    TextChannels[]          # later / optional
    CallRooms[]
      Room
        participants[]      # human | agent (+ seatSources)
        roomTranscript
        agentStreams[]
        stage               # sharer: human | agent
        addressSet
Config (peer of room, not nested under it)
  AgentProfile[]            # appearance overlay
  RosterPack[]              # seating presets
```

### Naming invariants (easy to get wrong)

| Say this | Not this | Why |
|---|---|---|
| `RosterPack` | Drive `Team` | `Team` is Cline’s runtime execution group |
| `AgentProfile` | prompt/tool store | Profile is name + inks + intent overlay |
| `.driveagent/<slug>/` | `.claude/` home | Wrong host metaphor under Cline |
| Spoken “team” | Type named Team | Means pack displayName or recruit query text |

### ARD-0001 … 0004 (all Status: Proposed)

| ID | One-line decision |
|---|---|
| **0001** | Agent home is `.driveagent/<slug>/`; compile into host runtime; Drive facets never hold prompts/tools/models |
| **0002** | Canonical YAML knowledge; derived `.derived/graph.json`; never hand-edit derived |
| **0003** | Recruit = search/rank; RosterPack = curated seating; both under Add; recruit does not write seats itself |
| **0004** | Learn is propose → accept/reject/mute; no transcript dump into knowledge |

**Open decision for Harrison (from handoffs).**  
Accept all four as written, or name one change before phase-0 schema work.

### Binding constraints (both PRs)

- Hub `ws://127.0.0.1:25463` is the **only** room writer. No default second daemon on `:7891`.
- Bun only.
- Privacy-strict defaults.
- Events-first stage; WebRTC later.
- No Cursor/VS Code chrome DOM injection.
- No second agent registry / second runtime path.
- No timeframes in plans.

---

## Code review notes (scaffold)

The early UI is intentionally local-state only. That is fine for a demo chrome, and dangerous if mistaken for the real product path.

**What is good.**

- Exhaustive `switch` on `DriveSubMode` in `toNativeMode`.
- Persona hint is injected as a system hint string, not a fake second chat participant.
- Types + small unit test for the mapping helpers.
- CLI parity starts as status + hotkey, matching “project events / show presence” philosophy.

**What to watch.**

- Webview Drive state living only in Chat React state will **diverge** from any future hub room authority. Phase 1 must replace this with hub projections.
- “Join call” in Chat is still the loudest entry in the scaffold, while plans say Drive tab is primary. Wireframes exist; the route does not.
- Persona / partner name in UI must not become a second prompt home when Driveagent lands (ARD-0001 invariant).
- Concurrent commit history already mixed planning docs and app source; keep later PRs thinner if possible.

---

## How to read the PR trees

### Fast path (30 minutes of attention)

1. `docs/plans/HANDOFF-drivecode.md` (PR #2 only) or `docs/plans/cline-drivemode/HANDOFF.md`
2. `00-vision.md` → `01-architecture.md`
3. `prd/prd-driveagent-portfolio.md` → `ard/README.md`
4. Open `docs/design/drive-wireframes/drive-tab-discord-slack.html` in a browser
5. Skim `apps/cline-hub/.../drive/` for what code actually exists

### Deep path

1. `05-workflows.md` (39 workflows) + `06-platform-config.md`
2. Feature specs for your slice (`DRV-ROOM-MVP`, `DRV-DRIVE-TAB`, `DRV-DRIVEAGENT-HOME`, …)
3. `TASK-GRAPH.md` + `AGENT-RUNBOOK.md`
4. `docs/plans/drivecode-sdk/02-architecture.md` + `decisions.tsv`

### Smoke checks suggested by the PR bodies

- [ ] Handoff open decision is clear cold
- [ ] Wireframe HTML loads; layout/accent switchers work
- [ ] RosterPack vs Team naming consistent in PRD/ARDs
- [ ] Optional: hub `drive/types.test.ts` via `bun -F @cline/cline-hub test`

---

## Suggested next moves after merge

1. **Decide ARDs** — `accept all` or `change: <id + new default>`.
2. **Close the duplicate** — if #2 merges, close #1 as superseded.
3. **Phase 0 slice** — shared Drive event + home/graph schemas; no-prompt-in-facet tests.
4. **Phase 1 slice** — hub room ops stub + Drive tab shell; retire webview-only room state.
5. **Keep SDK plan as sibling track** — do not block Driveagent homes on Omnigent parity.
6. **Package placement open item** — monorepo `@cline/drive` first (recommended default in handoff); extract only when a second host needs it.

---

## Risks / review flags

| Risk | Severity | Notes |
|---|---|---|
| Duplicate open PRs | Medium process | Same story twice; prefer #2 |
| Proposed ARDs treated as shipped law | High | Status is Proposed until Harrison accepts |
| Scaffold mistaken for hub authority | High | Local Chat state ≠ room single-writer |
| Overlay vs home tension | High | Must compile homes into Cline path only |
| Absolute Windows paths in handoffs | Low docs | Local canvas / prior-art paths won’t exist in cloud clones |
| No `@cline/drive` yet | Expected | Called out; do not invent a second package beside it |

---

## One-paragraph summary

These drafts define **Drive**: a Discord-style call room inside Cline (Slack-like chrome, Cline brand), where agents are roster participants with recruitable portfolios under `.driveagent/`, rooms are owned only by the hub on `:25463`, the stage is typed events not pixels, and learning never silently retains transcripts. PR #2 is the one to review and merge; the code inside is early chrome only — the kernel, homes, recruit, and real Drive tab still sit ahead of phase 0/1 work once the four ARDs are accepted or amended.
