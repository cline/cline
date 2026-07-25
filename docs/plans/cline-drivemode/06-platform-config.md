# 06 · Platform configuration. Identity, packs, and the facet surface

Back to [README](README.md). This document owns the user-facing configuration surface of Drive: what a user can change, who holds the truth for it, where it lives on disk, and when it ships.

It exists because three asks arrived together and they are the same ask. *Let me rename my partner and pick its colors.* *Let me build a cybersecurity team and drop the whole thing into a call.* *Do that level of detail for everything else too.* The first two are facets. The third is the mechanism. Building the two facets without the mechanism reproduces `cursorDrive.*` — forty-odd settings keys with no ownership story, no scope rules, and no answer for what happens when you change one mid-call. So the mechanism comes first and the two asks are its first two entries.

**Naming note up front.** The working name for a roster preset was `TeamPack`. It is now **`RosterPack`**. Cline already ships a runtime `Team` (`sdk/packages/shared/src/team/schema.ts`, tools under `sdk/packages/core/src/extensions/tools/team/`) with a lead, teammates, a mailbox, and outcomes. Any Drive identifier containing `Team` collides with it in grep, in autocomplete, in imports, and in support conversations. The full decision is in [Naming](#naming-rosterpack-not-teampack-not-team). The feature file is [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md), not `DRV-TEAM-PACK`.

---

## What this document decides

| # | Decision | Where |
|---|---|---|
| C1 | Configuration is a typed **facet catalog** with declared owner, scope, lane, privacy class, and phase. Not a settings bag. | [The mechanism](#the-mechanism-a-typed-facet-catalog) |
| C2 | Every facet sits in one of three **lanes** — durable, live, ephemeral. The lane is what makes "edit config during a live call" answerable without breaking the single-writer rule. | [Lanes](#lanes-durable-live-ephemeral) |
| C3 | Drive **overlays** `ConfiguredAgent`; it never forks it. Drive owns display name, two ink channels, seat role, pack membership, permission preset. Cline owns prompt, tools, skills, provider, model. | [AgentProfile](#agentprofile) |
| C4 | Roster presets are **`RosterPack`**. The word `Team` is reserved for Cline's runtime Team and is banned from Drive identifiers. | [Naming](#naming-rosterpack-not-teampack-not-team) |
| C5 | Seated participants carry **`seatSources`** — a set of who put them there. This is the answer to overlapping packs, idempotent re-add, and dismiss-pack-versus-dismiss-member. | [Pack membership is refcounted](#pack-membership-is-refcounted) |
| C6 | Appearance is **derived and repaints live**. Definition (prompt, tools, model) is **bound at seat time** and never hot-swapped mid-turn. | [Live-call conflict rules](#live-call-conflict-rules) |
| C7 | Colors persist as **tokens or palette indices**, never raw hex. The hub webview theme is authored in OKLCH, which makes a contrast floor mechanical rather than a review checklist. | [Colors](#colors-two-channels-no-hex) |
| C8 | The hub is the **only writer** of both durable facet files and live room state. Webview and CLI mutate through hub ops. `@cline/drive` stays pure. | [Ownership matrix](#ownership-matrix) |

---

## The mechanism: a typed facet catalog

A **facet** is one configurable thing. Each is declared once in a const catalog that carries everything a settings UI, a CLI, a privacy audit, and a phase gate need to know about it. Values are a mapped type over the catalog, so there is no `Record<string, unknown>` in the public API and no caller re-validates.

```ts
// sdk/packages/shared/src/drive/facets/types.ts

export type FacetOwner =
  | "hub"      // durable store IO and live room mutation
  | "kernel"   // pure defaults and derived policy; never persists
  | "webview"  // ephemeral UI chrome only; never room truth
  | "cli";     // ephemeral terminal chrome only

export type FacetScope = "user" | "workspace" | "room" | "session";

export type FacetLane = "durable" | "live" | "ephemeral";

export type PrivacyClass =
  | "public"     // safe to log and export
  | "sensitive"  // redact in logs; never in an export by default
  | "forbidden"; // structurally rejected (raw audio, transcript bodies)

export type ConflictRule =
  | "workspace_over_user"  // two-tier merge, same spirit as ConfiguredAgent search paths
  | "user_only"
  | "live_wins";           // a disk reload never overwrites a live value mid-call

export interface FacetDef<T> {
  readonly id: FacetId;
  readonly title: string;          // settings UI label and CLI help
  readonly owner: FacetOwner;
  readonly scope: FacetScope;
  readonly lane: FacetLane;
  readonly privacy: PrivacyClass;
  readonly conflict: ConflictRule;
  readonly phase: 0 | 1 | 2 | 3 | 4;
  readonly defaultValue: T;
  readonly schema: ZodType<T>;     // boundary parse
}

export type FacetKey = keyof FacetCatalog;
export type FacetValue<K extends FacetKey> =
  FacetCatalog[K] extends FacetDef<infer T> ? T : never;

export interface FacetStore {
  get<K extends FacetKey>(key: K, instanceId?: string): FacetValue<K>;
  set<K extends FacetKey>(key: K, value: FacetValue<K>, opts?: SetOpts): Promise<void>;
  listDefs(filter?: { phase?: number; lane?: FacetLane }): FacetDef<unknown>[];
  reload(disk: DriveFacetDiskSnapshot): void; // idempotent
}
```

The catalog is generic over **declaration, parse, defaults, scope merge, and typed access**. It is deliberately *not* generic over runtime policy. Three things proved that boundary while designing it, and each has a named home outside the schema:

- **Permission hierarchy is not a Zod shape.** A stored `full` preset on a specialist is illegal under a `readonly` parent. The facet stores intent; `capPreset(parent, child)` in the kernel is the authority at seat time. Same rule as `cursor-drive:.cursor/rules/operator-hierarchy.mdc`.
- **Keybindings collide with host chords.** A per-facet schema cannot see the hub's shortcut table. `validateKeybindings(map, hostTable)` runs at the hub boundary on set.
- **A prompt is not a Drive setting.** See [AgentProfile](#agentprofile).

### Lanes: durable, live, ephemeral

The lane is the load-bearing idea. Without it, "the user changed narration density while the partner is mid-turn" and "the user changed the room's sub-mode" look like the same operation, and one of them violates [01-architecture.md](01-architecture.md) D2.

| Lane | Truth lives | Written by | Survives a hub restart | Example |
|---|---|---|---|---|
| `durable` | Files under `.cline/drive/` | Hub, atomically | Yes | `agent.appearance`, `keybindings.map` |
| `live` | Hub memory, broadcast as room state | Hub room ops only | No | `room.live.addressSet`, `room.live.sharer` |
| `ephemeral` | Client memory | The client itself | No | Collapsed panel, scroll position, unsent draft chips |

Two rules fall out and both are testable:

1. **A durable facet may seed a live one at room creation. It may never overwrite one mid-call.** `drive.defaults.subMode` and `room.live.subMode` are separate catalog entries sharing a value schema. Seeding is a copy at `createOrAttach`. After that, only a hub op moves the live value.
2. **Nothing in the ephemeral lane is ever room truth.** No client `useState` holds participants, address set, stage sharer, or live mode. This is D6 restated as a lint rule the catalog can enforce, since every facet declares its lane.

---

## Domain model

### AgentProfile

Drive does not get to say what an agent *is*. Cline already does, in `ConfiguredAgent` YAML under `<workspace>/.cline/agents/` then `~/.cline/agents/`, resolved by `resolveAgentConfigSearchPaths` with first-match-by-normalized-name. That file owns name, description, tools, skills, provider, model, `maxIterations`, and the system prompt body.

Drive owns how that agent looks and behaves **as a participant in a call**. Nothing more.

```ts
/** Points at an existing agent. Overlay, never a fork. */
export type AgentRef =
  | { kind: "configured"; name: string }        // resolves via loadConfiguredAgentConfigs
  | { kind: "builtin"; id: "pair_partner" };    // the default partner, before any YAML exists

export interface AgentProfile {
  /** Stable id. For configured agents this is the normalized ConfiguredAgent name. */
  id: AgentProfileId;
  ref: AgentRef;

  /** Editable. Falls back to ConfiguredAgent.name when unset. */
  displayName?: string;

  /** Two independent channels. Neither is a hex string. */
  nameInk: InkRef;   // the participant's name in roster, chips, transcript byline
  bodyInk: InkRef;   // the participant's message and narration body text

  /** Optional, phase 3. A slot id from the Drive voice catalog, not a second identity. */
  voiceSlotId?: string;

  /** Seat intent. capPreset() is still the authority at seat time. */
  permissionPreset?: "readonly" | "standard" | "full";

  /** Sub-mode this profile prefers when it is the seated partner. */
  defaultSubMode?: DriveSubMode;
}
```

What is deliberately **not** on `AgentProfile`: `systemPrompt`, `tools`, `skills`, `providerId`, `modelId`, `maxIterations`. Copying those into a Drive store creates the second source of truth this whole design exists to prevent, guarantees drift from `.cline/agents/`, and drags prompt text into a Drive-persisted, potentially git-shared file. The `modelHint` the brief floated is a `ConfiguredAgent` concern; a Drive user who wants a different model authors a different agent.

The one honest concession: `ref.kind === "builtin"` exists so Drive works before the user has authored any YAML. The default pair partner is a Drive-shipped profile whose prompt comes from the ported persona skill (DRV-SKILL-PORT), not from a Drive config file.

**Resolution** is a pure kernel function. It cannot take `ConfiguredAgentConfig`, which lives in `@cline/core` — the kernel depends on `@cline/shared` only and exposes interfaces `@cline/core` consumes (D1 in [01-architecture.md](01-architecture.md), `sdk/AGENTS.md`). So the kernel declares the narrowest thing it actually needs and `@cline/core` projects into it at the call site:

```ts
/** All the kernel needs to know about an agent definition: that one exists
 *  under this name. @cline/core projects ConfiguredAgentConfig into this. */
export interface KnownAgent {
  readonly name: string;
}

export function resolveSeat(input: {
  profile: AgentProfile;
  known: readonly KnownAgent[];
  packOverride?: Partial<Pick<AgentProfile, "displayName" | "nameInk" | "bodyInk">>;
}): ResolvedSeat | { error: "unknown_agent" };
```

This is not just edge hygiene. A kernel that never receives a `ConfiguredAgentConfig` is structurally incapable of reading a `systemPrompt`, so "no prompts in Drive" holds by type rather than by discipline.

Precedence: kernel default `<` profile `<` pack member override. A `ConfiguredAgent` that disappears while its profile is seated does not evict the seat; the seat keeps its bound definition and the roster marks it stale. New seats for that ref fail with `unknown_agent`.

### RosterPack

```ts
export interface RosterPackMember {
  profileId: AgentProfileId;
  role: "pair_partner" | "specialist";
  /** Appearance override scoped to this pack only. */
  override?: Partial<Pick<AgentProfile, "displayName" | "nameInk" | "bodyInk">>;
}

export interface RosterPack {
  id: RosterPackId;          // "pack.cyber"
  slug: string;              // "cybersecurity"
  displayName: string;       // "Cybersecurity"
  description?: string;
  members: RosterPackMember[];  // order is seat order
  /** Chosen default: addressing the pack addresses its currently-seated members. */
  addressable: boolean;
}
```

A pack is a **list of references and seating intent**. It carries no prompts, no tools, and no model ids — which is also what makes exporting one privacy-clean.

Expansion is pure; seating is not:

```ts
export function expandRosterPack(input: {
  pack: RosterPack;
  profiles: ReadonlyMap<AgentProfileId, AgentProfile>;
  known: readonly KnownAgent[];
  parentPreset: PermissionPreset;
  seatCap: number;
}): {
  proposals: SeatProposal[];
  missing: AgentProfileId[];
  truncated: boolean;
};
```

The kernel produces proposals. The hub seats them, applies `capPreset`, and broadcasts one `CALL_STATE_UPDATE`. Clients never append to `participants[]` ([DRV-ROSTER](features/DRV-ROSTER.md)).

### Pack membership is refcounted

This is the part none of the obvious designs get right, and it is exactly what the brief asked about: overlapping members, idempotent re-add, and dismiss-pack versus dismiss-member.

Every seated participant carries the set of things that put it there.

```ts
export type SeatSource =
  | { kind: "manual" }                       // user seated it directly
  | { kind: "pack"; packId: RosterPackId }
  | { kind: "spawn"; parentId: ParticipantId }; // partner requested a specialist (DRV-TEAM-OPT)

interface Participant {
  // …existing fields
  seatSources: SeatSource[];   // never empty while seated
}
```

Four behaviours fall straight out, and none of them needs a special case:

| Action | Result |
|---|---|
| Add pack A, whose member `sentinel` is already seated manually | `sentinel` gains source `pack:A`. No duplicate seat, no re-spawn. Idempotent. |
| Add pack A twice | Second add is a no-op. Source sets are sets. |
| Add pack A and pack B, both containing `sentinel` | One seat, sources `{pack:A, pack:B}`. |
| Remove pack A | Drop source `pack:A` from every participant. A participant leaves only when its source set empties. `sentinel` stays, because B still claims it. |
| Dismiss member `sentinel` directly | Explicit removal. Clears all sources and cascades to its `spawn` children (`cursor-drive:.cursor/rules/operator-hierarchy.mdc`). |

Cascade dismiss and preset capping both key off the same structure. A `spawn` source names its parent, so dismissing a parent walks the graph. A pack does not become a parent — pack members are peers seated by a human, which is precisely how a `RosterPack` differs from a Cline `Team`.

### Relationship to Room, addressSet, stage, transcripts

The locked domain shape in [00-vision.md](00-vision.md) does not change. Configuration attaches to it at four points:

```
Room
  participants[]   ← seatSources[] added; appearance projected from AgentProfile each broadcast
  roomTranscript   ← renders bodyInk per participant; content unchanged, never persisted
  agentStreams[]   ← same
  stage            ← stage.*SharePolicy facets set the default sharer; live sharer is room state
  addressSet       ← gains { mode: "pack", packId } which resolves through seatSources
```

Addressing a pack resolves at send time to participants whose `seatSources` contain that `packId`. If that resolves to nothing, the send is **rejected**, not silently widened to everyone. [DRV-ADDRESS](features/DRV-ADDRESS.md) already rejects the empty set at the boundary; this is the same rule with one more producer.

### Persistence and schema versioning

Two files per scope, mirroring how `ConfiguredAgent` already resolves.

```
<workspace>/.cline/drive/registry.v1.json   # profiles, packs
<workspace>/.cline/drive/facets.v1.json     # everything else durable
~/.cline/drive/registry.v1.json
~/.cline/drive/facets.v1.json
```

- The major version is **in the filename**, so an old hub reading a v2 file fails closed instead of parsing half of it.
- `schemaVersion` is also inside the envelope. Unknown major → refuse to load, surface an actionable error. Migrations are pure functions in `@cline/shared`, applied once at the hub parse boundary. v1's migration is the identity.
- **Merge:** workspace overlays user, per entity id. Workspace wins on conflict.
- **Delete across scopes needs a tombstone.** File absence means "inherit from user scope", so hiding a user-level profile in one workspace is an explicit tombstone entry, not a missing key.
- Writes are atomic tmp-then-rename, the pattern already used by `file-team-store.ts` and by `claude-drive:src/atomicWrite.ts`.
- **Only the hub writes these files.** The CLI and webview send ops over the existing `:25463` socket. With the hub down, mutation commands fail fast rather than writing a file the hub will later clobber. Direct hand-edits are picked up on the hub's next op-start read; this is reload-on-op, not a watcher and not multi-master sync.

New path helpers sit next to `resolveAgentConfigSearchPaths` in `sdk/packages/shared/src/storage/paths.ts`: `resolveDriveRegistryPath(scope, workspaceRoot?)` and `resolveDriveConfigSearchPaths(workspaceRoot?)` returning `[workspace, user]`.

---

## Naming: RosterPack, not TeamPack, not Team

| Concept | Name | Lives in | Lifecycle |
|---|---|---|---|
| Runtime execution group: lead, teammates, mailbox, mission log, outcomes | **`Team`** (unchanged) | `sdk/packages/shared/src/team/schema.ts`, `sdk/packages/core/src/extensions/tools/team/` | Spawned by a lead agent mid-session |
| On-disk agent definition: prompt, tools, skills, model | **`ConfiguredAgent`** (unchanged) | `.cline/agents/*.yaml` | Authored by a human, loaded by Cline |
| Human-curated call seating preset | **`RosterPack`** | Drive registry, `roster.pack` facet | Authored by a human ahead of a call, seated by a human |

`TeamPack` was rejected because it still contains `Team`. A developer searching `Team` in this repo would hit both, `TeamTeammateSpec` and `TeamPackMember` autocomplete adjacent to each other, and a support thread saying "the team didn't join" would be ambiguous. `RosterPack` was chosen over `CallPack` because *roster* is already Drive's own noun for the participant list ([DRV-ROSTER](features/DRV-ROSTER.md)), so the preset is named after the thing it presets.

**Enforceable rule.** Inside `sdk/packages/shared/src/drive/**`, `sdk/packages/drive/**`, `sdk/packages/core/src/hub/**/drive*`, and `apps/*/**/drive/**`, an identifier matching `/Team|team_/` is a CI failure unless it appears in a comment that cites Cline Team as out of scope. UI copy says **pack**. The user is still allowed to say "add the cybersecurity team to the call" out loud — that phrase maps to a pack's `displayName`, which may well be "Cybersecurity", and the trigger table in [05-workflows.md](05-workflows.md) is where the phrase lives, not the type name.

Cost of diverging from the working name: one rename across plan docs, done here. Benefit: a substring firewall that holds forever.

---

## Identity and appearance

### Editing a name

Two entry points, one op.

- **Inline in the roster.** Double-click a participant's name, or `F2` on the focused row, edits in place. This is where the user is already looking when they decide the name is wrong, and it is the Discord/Slack muscle memory the Drive tab already borrows ([DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md)).
- **Drive settings panel → Agents.** The full editor: display name, both ink channels with a live preview of a name line and a body line, voice slot (phase 3), permission preset (phase 4), and **Reset to defaults** per field and for the whole profile.

Both call `drive_config_upsert_profile`. Neither writes a file or a participant directly. Renaming an unseated profile is a pure durable edit; renaming a seated one repaints the roster on the next broadcast (see [Live-call conflict rules](#live-call-conflict-rules)).

`displayName` is a label, never an identity. Addressing, event payloads, `seatSources`, and pack membership all key off `AgentProfileId`. Two profiles may share a display name; the roster disambiguates visually and nothing downstream breaks.

### Colors: two channels, no hex

```ts
export type InkRef =
  | { kind: "token"; token: DriveInkToken }   // tracks host theme
  | { kind: "palette"; index: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 };

export type DriveInkToken = "foreground" | "muted" | "success" | "warning" | "info";
```

- `nameInk` styles the byline, roster row, address chip, and call-strip chip. `bodyInk` styles message and narration body text. They are independent — a user can leave bodies at the readable default and only tint names, which is what most people actually want.
- **No hex is persisted.** The hub webview's theme is authored in OKLCH (`apps/cline-hub/src/webview/src/index.css`), which means a palette entry can be stored as a hue and chroma while lightness comes from the active theme. That turns the contrast floor into arithmetic instead of a design review: the resolver clamps L to meet the ratio against the current surface, in both light and dark, from one stored value. A stored hex cannot do this and would need two values plus a manual check.
- **Contrast is enforced at resolve, not at input.** If a resolved ink cannot meet the floor against the message well, the resolver falls back to `foreground` for names and `muted` for bodies and the editor shows why. The user never gets an unreadable transcript, and the editor never rejects a choice it could have simply adjusted.
- **Cline violet stays product chrome.** Per `CLINE-BRAND-TOKENS.md`, accent is used sparingly and means "this is the active thing". Spending it on an agent's name would make every message look like a call to action. A desaturated violet is available as one palette entry among eight; it is not a default.
- Defaults: `nameInk` is a palette index derived from a stable hash of the profile id, so a fresh roster is legible without anyone opening settings; `bodyInk` is `{ token: "muted" }`. Reset restores exactly these.

Canvas and wireframe surfaces are unaffected by any of this. Canvas keeps `useHostTheme()` and never embeds a value from this registry.

---

## RosterPacks

### Authoring

Drive settings → **Packs**. Create, name, describe, add profiles from a picker over `AgentProfile`s (which is itself a picker over `ConfiguredAgent`s plus the builtin partner), reorder to set seat order, and set the per-pack appearance override if the same agent should look different in this context. Shipped example: one `Cybersecurity` pack, present but empty of members until the user has agents to put in it — a filled example pointing at agents that do not exist is worse than an empty one.

### Adding a pack to a call

One action, three surfaces, all hitting `room_add_roster_pack`:

- **Roster header → Add → pack name.** The primary path, sitting where "add people" sits in every call product.
- **Slash command in the composer:** `/pack cybersecurity`.
- **Hotkey** for the pack picker. The specific chord is documented in [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md) when implemented, and must clear the existing hub shortcut table via `validateKeybindings` — the same collision risk [DRV-ADDRESS](features/DRV-ADDRESS.md) already flags.

The hub expands, caps presets, seats what it can, and returns `{ seated, alreadyPresent, missing, truncated }`. The UI reports the whole result in one line: *"Added Cybersecurity. Seated 2, sentinel was already here, redteam has no agent file."* Partial success is the default because refusing an entire pack over one missing YAML is the behaviour that makes people stop using packs.

**Multi-agent gating is unchanged.** [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md)'s roster cap and [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md)'s flag still hold. With the flag off, `seatCap` is 1: a single-member pack seats normally and a multi-member pack seats its first member and reports the rest as gated, with a pointer to the flag. Packs are a *configuration* feature that ships early; seating many agents is a *runtime* feature that stays gated. Conflating them would smuggle multi-agent past its own gate.

### Removing

- **Remove pack from call** drops that pack's `SeatSource` from every participant. Participants with other sources stay. This is the honest reading of "dismiss the pack" — it undoes what the pack did, not more.
- **Dismiss a member** is the existing participant dismissal, unchanged, with cascade to spawned children.
- Deleting a pack from the library never evicts anyone from a live call. It removes a future action, not a present participant.

---

## Platform config facet inventory

Thirty-four facets. Owner, scope, lane, default, privacy class, and plan phase for each. Phase numbers are [TASK-GRAPH](TASK-GRAPH.md) phases.

### Drive and room

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 1 | `drive.defaults.subMode` | hub | user | durable | `agent` | public | 0 |
| 2 | `room.live.subMode` | hub | room | live | seeded from #1 | public | 1 |
| 3 | `room.focusPolicy` | hub | user | durable | `focus-room` | public | 2 |
| 4 | `room.reconnect` | hub | user | durable | retry with backoff, banner after 2 | public | 1 |
| 5 | `room.live.participants` | hub | room | live | host + `pair_partner` | public | 1 |

#3 closes the multi-room focus gap ranked fifth in [05-workflows.md](05-workflows.md) (W-07): it names whether an unfocused room is a view or a runtime. #4 closes the reconnect gap ranked second (W-31). #5 is in the table precisely to record that participants are **never** durable.

### Identity and roster

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 6 | `agent.appearance` | hub | user, workspace | durable | builtin partner, hashed ink | public | 1 |
| 7 | `agent.permissionPreset` | hub | user, workspace | durable | partner `standard`, specialist `readonly` | public | 4 |
| 8 | `agent.voiceSlot` | hub | user | durable | engine default | public | 3 |
| 9 | `roster.pack` | hub | user, workspace | durable | one empty `Cybersecurity` example | public | 2 |
| 10 | `roster.packAddPolicy` | hub | user | durable | `partial-seat` | public | 2 |
| 11 | `roster.seatCap` | hub | user | durable | 1 until `teamOpt.enabled` | public | 4 |

### Addressing, steering, interruption

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 12 | `address.defaultSet` | hub | user | durable | `everyone` | public | 2 |
| 13 | `address.stickiness` | hub | user | durable | `reset-after-send` | public | 2 |
| 14 | `room.live.addressSet` | hub | room | live | from #12 | public | 2 |
| 15 | `interrupt.policy` | hub | user | durable | pause-after-tool | public | 2 |
| 16 | `steer.queue` | hub | user | durable | coalesce on | public | 2 |

### Narration and voice

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 17 | `narration.density` | hub | user | durable | `normal` | public | 1 |
| 18 | `tts.enabled` | hub | user | durable | `false` | public | 3 |
| 19 | `tts.maxSpokenSentences` | hub | user | durable | 3 | public | 3 |
| 20 | `stt.backend` | hub | user | durable | `webSpeech` | public | 3 |
| 21 | `captions.enabled` | hub | user | durable | on when mic armed | public | 3 |
| 22 | `voice.wakePhrase` | hub | user | durable | disabled | sensitive | 3 |

### Stage and share

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 23 | `stage.agentSharePolicy` | hub | user | durable | events-only | public | 2 |
| 24 | `stage.humanSharePolicy` | hub | user | durable | structured selection | public | 2 |
| 25 | `room.live.sharer` | hub | room | live | `agent` | public | 2 |

### Safety and policy

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 26 | `gates.highImpact` | hub | user, workspace | durable | prompt every time | public | 1 |
| 27 | `gates.throttle` | hub | user | durable | per-participant throttle on | public | 2 |
| 28 | `hooks.promptRewriteAllowlist` | hub | workspace | durable | empty | sensitive | 0 |
| 29 | `isolation.worktree` | hub | workspace | durable | off | public | 4 |

#26 gives the long-standing `DRV-GATES` gap — the top-ranked gap in [05-workflows.md](05-workflows.md), covering W-24 and W-25 — a concrete home. It is a **policy facet over existing plumbing**, not a new subsystem: the hub already emits `approval.requested` and tracks pending approvals (`sdk/packages/core/src/hub/server/handlers/approval-handlers.ts`). The gate is the question of *which* actions raise it and *when* a session-scoped allow expires. #28 closes the prompt-rewrite allowlist gap (W-34). #29 is the `DRV-ISOLATION` placeholder that blocks turning `teamOpt` on.

### Privacy

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 30 | `privacy.retention` | hub | user | durable | strict: nothing persisted | sensitive | 0 |
| 31 | `privacy.debugRetention` | hub | session | live | `false`, visible indicator when on | sensitive | 0 |

`privacy.debugRetention` is deliberately `live`, not `durable`. A debug flag that survives a restart is how a privacy-strict product quietly stops being one. Turning it on is a session act with a persistent visible indicator, per [DRV-PRIVACY](features/DRV-PRIVACY.md). Transcript bodies and audio buffers are class `forbidden` and have no facet at all — they are structurally rejected by the event schemas, not configured off.

### Models, surfaces, and portability

| # | Facet | Owner | Scope | Lane | Default | Privacy | Phase |
|---|---|---|---|---|---|---|---|
| 32 | `models.routingTiers` | hub | user | durable | tier map, no auto-escalate | sensitive | 2 |
| 33 | `keybindings.map` | hub | user | durable | product defaults | public | 2 |
| 34 | `cli.parity` | hub | user | durable | mirror the durable subset | public | 4 |

Two things that look like facets and are not, recorded so nobody adds them later:

- **`ui.ephemeral`** — collapsed panels, scroll position, unsent draft chips. Client-owned, lane `ephemeral`, never in a file, never broadcast. Named here so the lint rule has something to point at.
- **Pack import and export** is an *operation* on facets #6 and #9, not a facet. `drive_config_export_packs` emits profiles plus packs as refs only — no prompts, no tools, no model ids — which is what makes a pack safe to commit to a repo or paste in a thread. Import warns on refs with no matching `ConfiguredAgent` rather than failing. Phase 4.

### Ownership summary

| Owner | Facets | What it means |
|---|---|---|
| `hub` (durable) | 29 | Reads and atomically writes `.cline/drive/*.json`; the only writer |
| `hub` (live) | 5 | Room state in hub memory, mutated only by room ops, broadcast to clients (#2, #5, #14, #25, #31) |
| `kernel` | 0 as owner | `@cline/drive` *reads* facets and derives policy; owns no persistence, by D1 |
| `webview` / `cli` | 0 as owner | Send ops, render projections, own only ephemeral chrome, by D6 |

Durable facets are user-scoped unless stated otherwise. Four also accept a workspace override (`agent.appearance`, `agent.permissionPreset`, `roster.pack`, `gates.highImpact`) and two are workspace-only (`hooks.promptRewriteAllowlist`, `isolation.worktree`), because those six are the ones a team might reasonably want to commit alongside `.cline/agents/`.

---

## Ownership matrix

| Layer | Writes | Reads | Never |
|---|---|---|---|
| `@cline/shared` | nothing | nothing | — schemas and migrations only, no IO |
| `@cline/drive` (kernel) | nothing | an in-memory snapshot passed in | touches disk, sockets, or `participants[]` |
| `@cline/core` hub | `.cline/drive/*.json` atomically; all live room fields | catalog defs, both disk scopes | lets any other process write those files |
| Disk | — | hub only | is watched for multi-master sync |
| `@cline/cline-hub` webview | ephemeral chrome only | `CONFIG_SNAPSHOT` and `CALL_STATE_UPDATE` projections | `fs` access, or `useState` as room truth |
| `@cline/cli` | ephemeral chrome only | same projections over the same socket | a second daemon, a second port |

### Conflict rules

1. **Two scopes, one winner.** Workspace overlays user per entity id. Deletion across scopes is a tombstone; absence means inherit.
2. **Two clients, one writer.** Last hub-applied op wins. Clients rebase from the next `CONFIG_SNAPSHOT`. No client-side CRDT, consistent with D2's rejection of CRDTs for the room.
3. **Disk versus live.** A facet marked `live_wins` is never overwritten by a disk reload while the room exists. Reload refreshes the durable snapshot; the live value moves only through a hub op.
4. **Hub down.** Mutations fail fast with an actionable message. They do not queue to a file, because a queued write is a second writer wearing a disguise.
5. **Hand-edited file.** Read at the hub's next op-start. Not watched. A user who edits during a live call sees it on the next mutation, and that is documented rather than made magic.

### Live-call conflict rules

The split that makes this coherent: **appearance is derived, definition is bound.**

| Mutation while seated | Behaviour |
|---|---|
| Change `displayName`, `nameInk`, `bodyInk` | Durable write, then the hub reprojects appearance onto matching participants in the same op and emits one broadcast. Roster and transcript repaint immediately. No reseat, no flicker, no reconnect. |
| Change `permissionPreset` | Applies to future seats. The live seat keeps its capped preset for the current session; changing a running agent's authority mid-turn is a security surprise, not a feature. |
| Edit the underlying `ConfiguredAgent` YAML | The live seat keeps its bound definition. The roster marks it stale with a "reseat to apply" affordance. Prompts are never hot-swapped mid-turn. |
| Delete a profile that is seated | Rejected with `profile_in_use`. Remove it from the call first. |
| Delete a pack that is seated | Allowed. Drops that `SeatSource`; participants with other sources stay. |
| Add the same pack twice | No-op. Source sets are sets. |

Appearance can repaint live precisely because it is *derived from the durable store at broadcast time* rather than snapshotted at seat time. Definition cannot, because a turn in flight is reading it. One sentence, two opposite answers, and the reason is legible from the data flow rather than from a rule someone has to remember.

---

## Phasing

The MVP is one profile and two colors. Everything else is declared in the catalog so the shape is not foreclosed, and implemented when its phase arrives.

### MVP (plan phase 1, unflagged)

- Facet catalog scaffold in `@cline/shared` plus the durable store in the hub, with `agent.appearance` and `drive.defaults.subMode` as the only two live entries. Green parse, default, merge, and tombstone tests before any UI.
- The builtin `pair_partner` profile: rename, `nameInk`, `bodyInk`, reset to defaults.
- Inline rename in the roster; the two ink pickers in a settings panel with a live preview.
- Appearance seeded into the participant at `createOrAttach` and reprojected on every broadcast.
- Contrast resolver with the theme-derived lightness clamp.

**Delight test.** A user opens Drive, renames Adam to Ada, tints her name teal and leaves bodies at the readable default, and every subsequent message in the transcript is hers on sight — with no new agent file format, no restart, and no second daemon.

### Phase 2

`roster.pack` authoring and the "Add pack to call" action with `seatCap` still 1. Addressing, steering, interrupt, stage, and keybinding facets. `gates.highImpact` as a policy layer over the existing approval plumbing. `hooks.promptRewriteAllowlist`. `models.routingTiers`.

### Phase 3

Voice facets: `tts.*`, `stt.backend`, `captions.enabled`, `voice.wakePhrase`, and `agent.voiceSlot` on the profile.

### Phase 4

Multi-member pack seating once `teamOpt.enabled` and `isolation.worktree` are both real. `agent.permissionPreset` with `capPreset` enforcement. Pack import and export. `cli.parity` for the durable subset.

### Never

Prompts, tools, models, or skills in Drive config. Transcript or audio retention as a configurable facet. A durable debug-retention flag. A second config daemon.

---

## Open forks, each with a chosen default

Every one of these ships with a decision and an escape hatch. None of them blocks implementation.

| Fork | Chosen default | Escape hatch |
|---|---|---|
| Preset name | `RosterPack` | One rename; the CI substring rule is the only thing that must move with it |
| Overlapping pack members | Refcounted `seatSources`; a participant leaves when its source set empties | A force variant, "remove pack and its members", if users report the subtle version |
| Addressing a pack | `{ mode: "pack", packId }` resolves to currently-seated members with that source; empty resolution is rejected | `pack.addressable = false` per pack |
| Color format | Palette index or theme token in v1; OKLCH hue and chroma in v2, lightness always from theme | A `custom` `InkRef` variant behind the same contrast clamp |
| Live appearance edits | Repaint immediately, derived at broadcast | A per-profile "pin appearance for this call" if repainting proves distracting |
| Missing member on expand | Partial seat plus a typed `missing[]` report | `roster.packAddPolicy = "all-or-nothing"` |
| Pack scope | User scope by default; workspace packs opt-in and committable, refs only | Tombstones already handle per-workspace hiding |
| Deleting a seated profile | Rejected, `profile_in_use` | Remove from the call, then delete |
| Cross-scope deletion | Tombstones; absence means inherit | — |
| Name editor placement | Inline in the roster plus a full settings panel | Drop the inline path if the roster row gets crowded |
| Config store split | Two files, `registry` and `facets` | One envelope; entity ids do not change either way |

---

## Principles behind this document's decisions

- **Model the Domain.** `AgentProfile`, `RosterPack`, `SeatSource`, and `FacetDef` were named and typed before any UI or storage question was answered. `seatSources` is the whole design: overlapping packs, idempotent re-add, and dismiss-pack-versus-member stopped being three special cases the moment the data carried who seated whom.
- **Foundational Thinking.** The catalog is phase 0/1 work with two entries, because every later facet — gates, keybindings, voice, isolation — needs somewhere to land that already has an owner, a scope, a lane, and a privacy class. Adding the mechanism after ten settings exist is the expensive version.
- **Redesign from First Principles.** The obvious move is a Drive-owned agent registry with names, colors, and prompts in one file. It was written out in full and rejected: it forks `ConfiguredAgent`, guarantees drift, and puts prompt text in a git-shareable Drive file. The overlay came from asking what Drive actually owns, which is a participant's appearance in a call and nothing else.
- **Boundary Discipline.** Parse at two boundaries only, disk load and hub op. The kernel is pure and takes a snapshot. Surfaces render. Three things that cannot be expressed in a schema — permission capping, keybinding collisions, contrast floors — are named as functions at the boundary rather than pretended into Zod.
- **Separate Before Serializing Shared State.** The lane split is this principle applied to configuration rather than to the room. `drive.defaults.subMode` and `room.live.subMode` share a value schema and are separate facets, because one is a preference and the other is shared mutable state with exactly one writer.
- **Experience First.** The MVP is the smallest thing that feels good: rename your partner, tint her name, see it in the transcript immediately. Appearance repaints live and definition does not, because that is what the two feel like from the user's chair — a color is a preference, a prompt is a contract with a turn in flight.
- **Laziness Protocol.** Drive writes no agent loader, no second search path, no prompt store, and no approval subsystem. It overlays `ConfiguredAgent`, reuses `resolveAgentConfigSearchPaths`' two-tier precedence, and turns `DRV-GATES` into a policy facet over the hub's existing `approval.requested` plumbing.
- **Never Block on the Human.** Eleven forks, eleven chosen defaults, eleven escape hatches. The one that mattered most — the preset's name — was decided against the brief's own working name because the collision evidence was concrete, and the rename is one line of CI away from being reversible.
- **Sequence Work into Verifiable Units.** MVP is store plus one facet plus one profile, with parse and merge tests green before any UI exists. Packs are authoring first and seating second, so the configuration feature ships without smuggling multi-agent past its own gate.
