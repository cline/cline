# PRD 6: Driveagent Portfolio, Knowledge Graph, and Recruit

## Problem

Drive calls need more than a mute button and a pair partner. Users want to **recruit** the right agents for the work the way they already navigate skills and projects on a personal knowledge graph (harrisonhalperin.com): typed capabilities, applied cases, traversable relationships, human-gated edges.

Today’s gaps:

- Agents are either a single builtin partner or ad hoc Cline `ConfiguredAgent` YAML with no portfolio view.
- Roster packs seat known crews but cannot answer “who fits this security review?”
- Clicking a roster member has no first-class **profile** that shows capabilities, permissions, and knowledge.
- “Learned” agent memory risks becoming silent transcript retention, which violates Drive privacy defaults.
- BRIEF.md already solved **what context a run may see**. It did not solve **which agent to hire** or **what that agent knows about itself**.

## Solution

Treat each Drive-managed agent as a **recruitable portfolio** inside the Drive-tab call IA already decided for cline-drivecode:

1. **`.driveagent/<slug>/`** is the agent home (config + knowledge DB).
2. A **typed knowledge graph** (capabilities, cases, constraints, artifacts) lives under that home.
3. **Recruit** ranks agents (and suggests packs) from a task or need query.
4. **Seat** adds the chosen agent or pack to a call room (hub `:25463` single-writer; `seatSources` refcount).
5. Roster click offers **Transcript | Profile** (Discord/Slack identity split). Profile shows classifier, capabilities, access, env, and knowledge lens. Transcript keeps **address-follows-focus** from the main-chat demos.
6. Learning is **propose → human accept**, never automatic transcript dump.
7. Call chrome stays Cline-branded (violet edge selection, hub Composer patterns, Schibsted Grotesk). Agent inks are per-agent accents, not product chrome.

Drive tab remains primary; Chat Join call is only a shortcut into the active room.

This extends the agent standards stack:

```text
AGENTS.md / persona     → how the agent behaves
SKILL.md / tools        → what the agent can invoke
BRIEF.md                → what repo context a run may see
.driveagent/ + graph    → who the agent is, what it knows, when to recruit it
```

BRIEF and Driveagent are complementary. BRIEF scopes *codebase* context for a turn. The agent graph scopes *portfolio* context and recruitment.

## Goals

- Make agents inspectable and recruitable from the Drive tab.
- Keep one durable home per agent under `.driveagent/<slug>/`.
- Keep call appearance (name ink / body ink) as a Drive overlay; keep prompts/tools in the home, not in Drive facets.
- Preserve privacy-strict defaults.
- Stay host-adaptable (Cline compile path first; Cursor/Claude adapters later via drivecode-sdk).

## Non-goals

- Replacing BRIEF.md, AGENTS.md, or SKILL.md.
- A single global mega-graph as the only store (per-agent homes remain source of truth; indexes are projections).
- Auto-writing room transcripts into knowledge.
- Replacing `RosterPack` (packs stay curated seating presets; recruit *suggests* packs).
- Shipping embeddings / graphify sidecar in MVP.
- Using the word `Team` for Drive types (Cline owns runtime `Team`; Drive uses `RosterPack`).

## Personas

| Persona | Need |
|---|---|
| Pair programmer | Rename/tint partner; open transcript vs profile; recruit a specialist mid-call |
| Tech lead | Maintain cybersecurity / review packs; recruit by need; gate learned edges |
| Agent author | Edit `.driveagent/` YAML; see compiled graph; know what will be injected |
| Privacy-conscious user | Default strict; no silent retention; secrets as refs |

## User stories

1. As a user, when I click a roster member I can choose **Chat/transcript** or **Profile**.
2. As a user, an agent profile shows a **classifier** (kind, live state, permissions, stale) then sections for capabilities, access, env, and knowledge.
3. As a user, I can browse that agent’s `.driveagent/<slug>/` file tree and edit files when I have write access.
4. As a user, I can ask “who should review auth?” and get ranked agents with reasons (matched capabilities/cases).
5. As a user, I can add a ranked agent or a suggested pack to the call in one action.
6. As a user, I can author capability↔case edges the way I author skills on projects on my site.
7. As a user, after a call I can **accept or reject** proposed knowledge edges; nothing durable is written without that gate.
8. As a user, I never find raw call transcripts under `knowledge/` unless I explicitly export under a debug flag.

## Information architecture

### Agent home

```text
.driveagent/<slug>/
  agent.yaml              # identity, tools, skill refs, model, prompt path
  permissions.yaml        # preset intent, overrides, approval hooks
  env.yaml                # non-secret env; secretRef for secrets
  knowledge/
    catalog.yaml          # controlled vocabulary (site skills.yaml analog)
    nodes/                # capability | case | constraint | artifact | concept
    edges.yaml            # applied_in, requires, conflicts_with, related_to, learned_from
    private/              # gitignored durable notes
  .derived/               # machine outputs — never hand-edit
    graph.json            # compiled projection
    recruit-index-shard.json  # optional
    audit-last-inject.json    # last turn graph slice (optional, privacy-tiered)
```

Canonical vs derived mirrors BRIEF’s `.agents/briefs/` vs `latest/` split ([dot-agents-layout](https://github.com/hhalperin/briefs/blob/main/docs/standards/brief/dot-agents-layout.md)).

### Graph node kinds (MVP)

| Kind | Analog on personal site | Example |
|---|---|---|
| `capability` | Skill catalog entry | `threat-modeling`, `tool:browser` |
| `case` | Project with `skills[].applied` | `oauth-hardening-2026` |
| `constraint` | Policy / will-not | `no-prod-writes-without-gate` |
| `artifact` | Doc / runbook link | `docs/runbooks/auth.md` |
| `concept` | Glossary term | `seatSources` |

### Edge kinds (MVP)

`has_capability`, `applied_in`, `requires`, `conflicts_with`, `related_to`, `learned_from` (evidence pointer only).

### Recruit API (conceptual)

```ts
recruit({
  need: string | { capabilities?: string[]; domains?: string[] },
  limit?: number,
  excludeSeated?: boolean,
}): RankedAgent[]
// each: { slug, score, reasons: MatchedEdge[], suggestedPackIds? }
```

## Phased milestones

### P0 — Home + profile (no recruit yet)

- Directory contract and schemas for `agent.yaml`, `permissions.yaml`, empty `knowledge/`.
- Loader compiles home → runtime view Cline can execute (or marks builtin read-only).
- Roster click → Transcript | Profile.
- Profile: classifier + capabilities list from home + file tree (view) + open in editor.
- Appearance remains Drive facet overlay ([DRV-AGENT-PROFILE](../features/DRV-AGENT-PROFILE.md)).
- Acceptance: create `.driveagent/pair-partner/` (or builtin synthetic), open profile, see tools/skills lists, open `agent.yaml` in editor; no Drive facet file contains `systemPrompt`.

### P1 — Graph author + compile

- `knowledge/catalog.yaml`, nodes, edges schema + lint.
- Compile to `.derived/graph.json` (deterministic ordering).
- Profile Knowledge section lists capabilities and cases (`applied_in`).
- Acceptance: author two capabilities and one case with edges; compile; profile lens shows them; hand-edit of `graph.json` is overwritten on next compile.

### P2 — Recruit MVP

- Workspace (+ user) scan builds in-memory recruit index (no second daemon).
- Lexical/tag score over catalog + capability labels (harrison-site style; no embeddings).
- Drive tab **Add → Recruit** returns ranked agents + pack suggestions.
- Seat from result; multi-agent still gated by existing `teamOpt` / seatCap.
- Acceptance: query “security review” ranks an agent tagged security above an unrelated partner; seating respects roster cap.

### P3 — Gated learn + inject audit

- After call (or on explicit “remember”), propose edges from structured outcomes (skills used, artifacts touched), never raw transcripts.
- Human confirm / reject / mute (Constellation pattern).
- Turn inject logs which node ids were added to context (BRIEF audit analog); privacy-tiered retention.
- Graduated retrieval: inject summaries/headings of matched nodes by default, full only when selected.
- Acceptance: rejected proposal leaves disk unchanged; accepted edge appears after compile; inject audit lists node ids only by default.

### P4 — Semantic recruit + host adapters (later)

- Optional embeddings / graphify-style scoring when lexical fails.
- drivecode-sdk owns AgentHome + AgentGraph + `recruit()`; Cline/Cursor/Claude adapters.
- Cross-agent pack export with public catalog nodes only.

## UX placement (main-chat decisions)

| Surface | Behavior |
|---|---|
| Drive tab left nav | Channels + Drive calls; nested roster under live call ([DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md)) |
| Roster click | Chooser: Transcript \| Profile ([DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md), W-37) |
| Transcript choice | Focus agent stream; address-follows-focus |
| Profile choice | Classifier + sections; no silent broadcast |
| Add menu | Pack picker (W-36) and Recruit (W-38) |
| Appearance | Drive facets; violet **edge** for selection density; filled CTAs only |
| Stage | Events-first agent share; user share structured MVP; WebRTC later |

## Requirements traceability

| Req | Feature / plan | ARD | Workflow |
|---|---|---|---|
| Home directory | [DRV-DRIVEAGENT-HOME](../features/DRV-DRIVEAGENT-HOME.md) | ARD-0001 | W-19, W-35 |
| Graph + compile | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md) | ARD-0002 | W-39 |
| Recruit | [DRV-RECRUIT](../features/DRV-RECRUIT.md) | ARD-0003 | W-38 |
| Learn / privacy | DRV-PRIVACY + gated learn | ARD-0004 | W-39, W-26 |
| Profile click | [DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md) | ARD-0001 | W-19, W-37 |
| Appearance overlay | [DRV-AGENT-PROFILE](../features/DRV-AGENT-PROFILE.md) | ARD-0001 | W-35 |
| Packs | [DRV-ROSTER-PACK](../features/DRV-ROSTER-PACK.md) | ARD-0003 | W-36 |

## Success metrics (qualitative MVP)

- User can recruit a specialist without memorizing slugs.
- Profile answers “what can this agent do?” without opening raw YAML.
- Zero accidental transcript files under `.driveagent/**/knowledge/`.
- Pack + recruit coexist without naming collisions with Cline `Team`.

## Risks

| Risk | Mitigation |
|---|---|
| Second agent registry vs Cline | Home compiles into Cline execution types; no parallel prompt store in Drive facets |
| Privacy regression via “learning” | Propose/accept only; ARD-0004 |
| Scope creep into BRIEF territory | Portfolio/recruit only; BRIEF keeps repo context lifecycle |
| Embeddings complexity | Deferred to P4; lexical recruit first |
| Git secret leak | `env` secretRefs; `knowledge/private/` gitignored |

## References

- Personal site pattern: skills catalog + project `skills[].applied` + `ContextGraphLens` (`harrison-site`)
- BRIEF stack and canonical/derived layout (`briefs` repo)
- BRIEF lessons: complementary not competing; invest in artifacts; resist scope creep (`docs/blog/02-lessons-learned.md`)
- Drive platform config: [06-platform-config.md](../06-platform-config.md)
- Workflows catalog: [05-workflows.md](../05-workflows.md)
- Prior art (routing graphs, not portfolios): claude-drive graphify integration (do not fuse stores)
