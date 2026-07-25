# 02 · Architecture

Answers questions 2 through 7 and 9 from the brief: the layer cake, type ownership, the host adapter model, the relationship to `@cline/drive`, package layout, the MVP surface, and risks.

Inputs: [`00-discovery-omnigent.md`](./00-discovery-omnigent.md), [`01-problem-and-scope.md`](./01-problem-and-scope.md), and the binding plan documents [`../cline-drivemode/01-architecture.md`](../cline-drivemode/01-architecture.md), [`../cline-drivemode/06-platform-config.md`](../cline-drivemode/06-platform-config.md), [`../cline-drivemode/features/DRV-KERNEL.md`](../cline-drivemode/features/DRV-KERNEL.md), [`../cline-drivemode/features/DRV-EVENTS.md`](../cline-drivemode/features/DRV-EVENTS.md).

---

## 1. The headline decision

**`drivecode-sdk` and `@cline/drive` are the same package.** The already-planned kernel at `sdk/packages/drive` grows the host port, the capability descriptor, and the conformance kit. Nothing new is created beside it.

The name `drivecode-sdk` describes a *role* that package plays — the portable Drive harness — not a second artifact. Within the Cline monorepo the package id stays `@cline/drive`, because `DRV-KERNEL` and the `01-architecture.md` package map already name it that and continuity is worth more than a label. If the package is ever published for an out-of-tree host, it publishes under the `drivecode-sdk` name; that is a `package.json` field, not an architecture.

### Why merge, and not the alternatives

**Sits above `@cline/drive` as a separate package** — rejected. The argument for it is that decision D1 forbids transport and host IO in the kernel, so the host port cannot live there. That argument is wrong on a point of fact: `DriveHostPort` is a TypeScript interface with no implementation and no imports. Declaring the shape of an effect is not performing one. A package that declares `readDurableFacets(): Promise<unknown>` and never calls it remains pure, testable without IO, and shippable to a browser. The real consequence of splitting is worse: the upper package would re-export `transitionDriveMode`, `narrate`, `classifyInterrupt`, `expandRosterPack`, `capPreset`, and `mergeFacetScopes` from the lower one, which makes it a pass-through with a version number — two changelogs, two release gates, and a permanent argument about which side a new pure function belongs on.

**Rename `@cline/drive` to `drivecode-sdk`** — rejected. It invalidates `DRV-KERNEL`'s acceptance criteria and the package map for no behavioural gain, and it does not answer the only question that matters, which is where the Cline binding lives.

**Sits below `@cline/drive`** — rejected. Below the kernel is `@cline/shared`, which is schemas. Schemas are not a harness; a harness is the policies plus the port.

**A separate repository named `drivecode-sdk`** — rejected on direct evidence. `cursor-drive/src/syncTypes.ts` and `claude-drive/src/syncTypes.ts` are the same file maintained by hand across two git roots, and both repos' `AGENTS.md` instruct humans to "sync manually." That instruction is the bug. One monorepo makes the contract a compile-time dependency edge that `bun run build:sdk` enforces. Publishing is the correct cross-repo boundary; copy-paste is not.

**Porting the `cursor-drive` MCP server on `:7891` as the meta server** — rejected by binding constraint. A second daemon is a second writer wearing a port number.

---

## 2. Layer cake

```
┌────────────────────────────────────────────────────────────────────┐
│ Apps — Drive tab webview, CLI TUI, future surfaces                 │
│   writes  ephemeral chrome only (local UI state)                   │
│   reads   RoomSnapshot, stage + roster projections                 │
│   never   disk, room truth, agent YAML, a second socket            │
├────────────────────────────────────────────────────────────────────┤
│ Host binding — @cline/core/src/hub/drive-host/                     │
│   writes  durable .cline/drive/*.json, live room via hub ops       │
│   reads   kernel proposals, facet defs, event schemas              │
│   never   reimplements a policy the kernel already owns            │
│   is      the single writer, on ws://127.0.0.1:25463               │
├────────────────────────────────────────────────────────────────────┤
│ @cline/drive — the Drive harness  (role name: drivecode-sdk)       │
│   owns    pure policies, room reducer, projections, DriveHostPort, │
│           HostCapabilities, conformance kit                        │
│   writes  nothing                                                  │
│   reads   snapshots and events passed in as arguments              │
│   never   agent loop, prompt bodies, sockets, fs, UI               │
├────────────────────────────────────────────────────────────────────┤
│ @cline/shared — contracts                                          │
│   owns    DriveEvent union, Room/Participant, AgentProfile,        │
│           RosterPack, facet schema defs, path helpers              │
│   writes  nothing.  reads nothing at runtime                       │
├────────────────────────────────────────────────────────────────────┤
│ Agent runtime — @cline/agents + session path in @cline/core        │
│   owns    turns, tools, hooks, ConfiguredAgent, model routing      │
│   emits   structured work facts the host binding lifts into events │
│   never   Drive roster truth, RosterPack, stage                    │
└────────────────────────────────────────────────────────────────────┘
```

Read it as three verbs. **The harness proposes. The host commits. Apps project.**

That triple is the whole design. Every question of the form "where does X go?" resolves by asking which verb X is.

Operators are seated Drive participants. They are not Cline `Team` execution groups, and the two never share a type.

---

## 3. Ownership matrix

| Concern | Owner | Status vs. existing plan |
|---|---|---|
| `DriveEvent` versioned union, envelope, parse | `@cline/shared` | unchanged (`DRV-EVENTS`, D4) |
| `Room`, `Participant`, `RoomSnapshot` shapes | `@cline/shared` | unchanged |
| `AgentProfile`, `RosterPack` schemas | `@cline/shared` | unchanged (`06-platform-config`) |
| Facet catalog **definitions** — id, lane, privacy class, default, zod | `@cline/shared` | unchanged |
| Facet **merge and tombstone rules** (pure) | `@cline/drive` | unchanged |
| Drive-mode state machine | `@cline/drive` | unchanged (`DRV-KERNEL`) |
| Narration policy | `@cline/drive` | unchanged |
| Interrupt classifier | `@cline/drive` | unchanged |
| RosterPack expansion, `seatSources` refcount math | `@cline/drive` | unchanged |
| Permission preset capping | `@cline/drive` | unchanged |
| Address resolution | `@cline/drive` | unchanged |
| **Room reducer** (pure fold over events) | `@cline/drive` | **change — see 3.1** |
| **Stage projection** (last-work-event-wins) | `@cline/drive` | **change — see 3.1** |
| **`DriveHostPort`, `HostCapabilities`, conformance kit** | `@cline/drive` | **change — new rows** |
| Durable config IO, atomic writes | `@cline/core` hub | unchanged |
| Room ops, seating commits, broadcast | `@cline/core` hub | unchanged, single writer |
| Hook prompt rewrite mechanics | `@cline/core` hooks | unchanged |
| Drive tab rendering, TUI rendering | apps | unchanged |

### 3.1 The two rows that change, and why

`01-architecture.md` assigns "Room, roster, stage ops, broadcasts" to `@cline/core`. That line conflates two different things: the *pure fold* from an event stream to a snapshot, and the *single-writer commit* of an operation. They must split.

If the fold stays in `@cline/core`, the webview cannot use it — the webview must not import the hub — so the webview will grow its own reducer. That is the `syncTypes.ts` failure reproduced inside a single repository, and it is worse there because there is no second `AGENTS.md` to warn anyone. Put `reduceRoom` and `projectStage` in `@cline/drive`, which both the hub and the browser bundle may import, and there is exactly one fold.

`@cline/core` keeps `commitRoomOp` and `broadcast`. It stays the only writer. This is a clarification of D6, not a weakening of it.

### 3.2 Types the SDK must not own

| Type or concept | Owner | Why not Drive |
|---|---|---|
| `ConfiguredAgent`, system prompt, tool list, skills, provider, model id | `.cline/agents/*.yaml`, `@cline/core` | Drive overlays appearance only. A prompt field on `AgentProfile` is the prompt-ownership leak. |
| `Team`, `TeamTeammateSpec`, team mailbox | Cline runtime tools | Execution group, not seating. Drive uses `RosterPack`. |
| Raw audio buffers, verbatim transcript bodies | nobody — forbidden class | Privacy-strict. No facet, no event field, no debug flag. |
| WebRTC session, pixel frame, codec | later media plane | Events-first stage. Not MVP. |
| VS Code `Webview`, Cursor Composer chrome | apps | No DOM hacks into host chrome. |
| Hub wire frames beyond `DriveEvent` | `@cline/core` | Transport detail behind the port. |
| `Gateway*` provider option routing | `@cline/llms` | Explicit boundary in `sdk/packages/llms/AGENTS.md`. |

The enforcement is structural rather than advisory: `AgentProfile` has no prompt-shaped field to set, and the kernel's view of an agent is name-only.

---

## 4. Host adapter model

Omnigent's answer to "many harnesses, one product" is a narrow adapter plus a published capability matrix plus a bench that runs the matrix. Drive copies all three. The adapter is the part that keeps the SDK from becoming mush: everything host-specific must be expressible as one of these methods, and if it cannot be, that is the signal to add a capability flag rather than a branch on host name.

```ts
// @cline/drive — declared here, implemented by hosts. No imports, no IO.

export interface HostCapabilities {
  readonly harnessId: string;              // "cline" | "cursor" | "claude-code" | …
  readonly schemaVersion: 1;

  readonly roomOps: boolean;               // can commit seating and address changes
  readonly eventsFirstStage: boolean;      // can carry structured work events
  readonly durableConfigIo: boolean;       // can persist workspace facets atomically
  readonly promptRewrite: boolean;         // can mutate an outbound turn before submit
  readonly worktreeIsolation: boolean;     // can give a participant its own worktree
  readonly voiceIo: boolean;               // STT in, TTS out
  readonly pixelShare: boolean;            // false for every MVP host

  readonly localOnly: boolean;             // must be true — privacy-strict
  readonly writerEndpoint: string;         // "ws://127.0.0.1:25463" for Cline
}

export interface DriveHostPort {
  readonly capabilities: HostCapabilities;

  resolveKnownAgents(): Promise<ReadonlyArray<{ name: string }>>;

  readDurableFacets(workspaceRoot: string): Promise<unknown>;
  writeDurableFacets(workspaceRoot: string, next: unknown): Promise<void>;

  commitRoomOp(op: RoomOp): Promise<RoomSnapshot>;
  broadcast(event: DriveEvent): Promise<void>;
  subscribe(handler: (event: DriveEvent) => void): () => void;

  bridgeWorkEvents(handler: (event: DriveEvent) => void): () => void;
  applyPromptRewrite(decision: PromptRewriteDecision): Promise<void>;
}
```

`writerEndpoint` is a required field, not an optional one. A host cannot forget to declare who the single writer is, and a host that declares `:7891` is visible in a diff and in a bench report.

### Where hosts actually differ

The capability matrix earns its place only if the differences are real. They are:

- **Agent discovery.** Cline resolves `ConfiguredAgent` from `.cline/agents/*.yaml` along a documented search path. Cursor has no equivalent loader; it has rules and skills under `.cursor/`. Claude Code has subagent definitions under `.claude/agents/`. Three different resolvers, one `resolveKnownAgents()` returning names.
- **Turn mutation.** Cline rewrites through the `@cline/core` hook engine. Cursor rewrites through `beforeSubmitPrompt`, a different payload shape, and one that `cursor-drive`'s `vision-invariants.mdc` treats as the primary pipeline entry. Claude Code uses `user_prompt_submit`. Same intent, three payloads — hence `applyPromptRewrite` taking a decision object the host translates, rather than the harness touching a hook API.
- **Work-event source.** Cline has structured session events from `@cline/agents`. Cursor's Composer does not expose an equivalent stream to extensions, so a Cursor binding must synthesise events from file watching and MCP callbacks, which is lower fidelity. That is a genuine capability difference, and `eventsFirstStage: false` is a legitimate answer for a host that cannot do it.
- **The writer.** Cline has the hub. Cursor and Claude Code do not, and a binding for either must nominate an equivalent single writer before it is allowed to exist. This is where a second daemon would sneak in, so it is a declared field.

### The conformance kit

```ts
export function runHostConformance(
  host: DriveHostPort,
  required: Partial<HostCapabilities>,
): Promise<ConformanceReport>;

export function fakeHost(capabilities: HostCapabilities): DriveHostPort;
```

Two properties make this worth building rather than describing. First, it **fails closed**: a host that declares `promptRewrite: true` and then no-ops must produce a mismatch, so the matrix cannot rot into marketing. Second, `fakeHost` means every kernel policy is testable with no hub, no sockets, and no Cline — which is also the proof that the port is narrow enough for a second host to implement.

MVP ships one real binding (Cline) and `fakeHost`. Cursor and Claude Code bindings stay documentation until a product asks for them; the kit exists so that when one is asked for, the answer is a checklist rather than an archaeology project.

---

## 5. Package layout

```
sdk/packages/shared/src/drive/          @cline/shared   schemas, event union, facet defs, migrations
sdk/packages/drive/src/                 @cline/drive    policies, reducer, projections, port, capabilities
sdk/packages/drive/src/conformance/     @cline/drive    runHostConformance, fakeHost
sdk/packages/core/src/hub/drive-host/   @cline/core     createClineDriveHost, clineCapabilities
sdk/packages/core/src/hub/collaboration/ @cline/core    room ops, seating commits, broadcast
sdk/packages/core/src/hub/drive-config/ @cline/core     atomic durable facet IO
apps/cline-hub/src/webview/src/drive/   hub app         Drive tab renderers
apps/cli/src/tui/                       CLI app         TUI parity renderers
```

Legal dependency direction, unchanged from `sdk/AGENTS.md`:

```
@cline/shared → @cline/drive → @cline/core → apps
```

`@cline/drive` depends on `@cline/shared` and nothing else. Never `@cline/llms`, never `@cline/agents`, never an app.

### On schema location

The Drive schemas stay in `@cline/shared`. There is a real argument against it — a non-Cline host implementing `DriveHostPort` would have to depend on `@cline/shared`, which per `sdk/AGENTS.md` also carries the hook engine and extension registry, and pulling that into a Cursor extension to get a `DriveEvent` type is the wrong shape.

Keeping them where `DRV-EVENTS` already put them is still correct today, because that argument only becomes a cost when a second host exists, and moving a schema module between two packages in one monorepo is a mechanical refactor with a compiler to catch every call site. It is not a one-way door, so it does not need deciding now.

To keep it cheap, one gate: **`sdk/packages/drive/src/**` imports from `@cline/shared` type-only.** No runtime value crosses that edge. Extracting the schemas later then becomes a file move rather than a dependency untangling. This is checkable in CI and is the escape hatch tracked in [§8](#8-open-forks).

---

## 6. MVP surface

Smallest API that lets the Drive tab work end to end.

**Composition**
- `createDriveHarness({ host })` → `DriveHarness`
- `DriveHarness.rooms.{ createOrAttach, addRosterPack, setAddress, raiseHand, setSharer, setSubMode }`
- `DriveHarness.onEvent(handler)`

**Host contract**
- `DriveHostPort`, `HostCapabilities`, `RoomOp`, `PromptRewriteDecision`

**Pure policies**
- `transitionDriveMode`, `narrate`, `classifyInterrupt`
- `expandRosterPack`, `applySeatSourceDelta`, `capPreset`
- `resolveAddress`, `mergeFacetScopes`

**Projections** — browser-safe, no Node built-ins
- `reduceRoom`, `projectStage`, `projectRoster`

**Conformance**
- `runHostConformance`, `fakeHost`, `ConformanceReport`

### Non-goals

No agent loop, no prompt construction, no model routing, no provider handlers. No fs and no sockets. No UI components. No `Team`. No media plane. No cross-machine sync. No plugin registry — Cline already has skills, hooks, and extensions, and a second extension system is the mush this design exists to prevent.

---

## 7. Risks

| Risk | Mechanical mitigation |
|---|---|
| SDK becomes a second copy of the kernel | It *is* the kernel. Merged, so there is no second package to drift into. |
| Duplicate registries — `AgentProfile` defined twice | Schemas in `@cline/shared` only. The harness imports types and never declares a second profile struct. |
| A second daemon | `writerEndpoint` is required in `HostCapabilities`; the Cline binding hard-codes `25463`; CI greps for a `:7891` default under `sdk/packages/drive/**` and the Drive hub paths. |
| Prompt ownership leaks | `AgentProfile` has no prompt-shaped field. Kernel's agent view is name-only. |
| A second reducer appears in the webview | `reduceRoom` lives in `@cline/drive`, which the browser bundle may import. There is nothing to reimplement. |
| Webview writes room state | `@cline/drive` exports no mutator that takes a `RoomSnapshot` and returns a committed one. Only `commitRoomOp` on the port does that, and only the hub holds a port. |
| `Team` naming creeps back | `RosterPack` in schemas; no `Team` symbol anywhere under `sdk/packages/drive`. |
| Multi-host ambition dilutes the Cline MVP | One real binding plus `fakeHost`. Other bindings are `not implemented` sketches in docs. |
| Implementers invent a fourth home for reducers | The `01-architecture.md` package map is updated in the same change set that scaffolds the port. |

---

## 8. Open forks

Each has a chosen default so nothing blocks.

| Fork | Default taken | Revisit when |
|---|---|---|
| Package id inside the monorepo | `@cline/drive`, with `drivecode-sdk` as the publish name if ever needed | an out-of-tree host actually consumes it |
| Drive schema location | `@cline/shared`, with a type-only import gate on the drive package | a second host binding is scheduled |
| Where the Cline binding lives | `@cline/core/src/hub/drive-host/` | never — the writer owns the binding |
| Conformance kit entrypoint | subpath `@cline/drive/conformance`, excluded from the browser bundle | bundle size complains |
| Capability granularity | seven Drive-feature flags, not per-method | a host needs half of one flag |
| `voiceIo` in MVP | declared in the matrix, `false` for the MVP Cline binding | voice work starts |
