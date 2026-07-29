# 04 · How cline-drivecode consumes the harness

Answers question 5 in operational terms, and shows the two SDKs side by side so the division of labour is concrete rather than asserted.

---

## 1. Two SDKs, one product

`cline-drivecode` sits on two stacks and they do not overlap.

| | Cline SDK — `@cline/{shared,llms,agents,core}` | Drive harness — `@cline/drive`, role name `drivecode-sdk` |
|---|---|---|
| Answers | how does one agent take a turn | how do several participants share one live session |
| Owns | agent loop, tools, hooks, model routing, sessions, storage, the hub | rooms, seating, addressing, stage, modes, narration, interrupts |
| Unit | a turn | a room |
| Effects | performs them | describes them and hands them to a host |
| Grows with | model and provider capability | collaboration surface |

The harness never calls the agent loop, and the agent loop never learns what a room is. The seam between them is the host binding, which lifts structured session facts into `work`-track Drive events and applies prompt-rewrite decisions back down.

That seam is one direction each way, and both directions are typed. Nothing else crosses.

---

## 2. Consumption walkthrough

### Hub startup — the only writer

```ts
import { createDriveHarness } from "@cline/drive";
import { createClineDriveHost, clineCapabilities } from "@cline/core/hub/drive-host";

const host = createClineDriveHost({
  writerEndpoint: "ws://127.0.0.1:25463",
  workspaceRoot,
});

const drive = createDriveHarness({ host });
await drive.start();
```

The hub already exists and already owns `:25463`. Drive adds a namespace on it. No new process, no new port, no `:7891`.

### Opening a call

```ts
const room = await drive.rooms.createOrAttach({
  humanId: "local-user",
  partnerProfileId: "builtin.pair_partner",
});

await drive.rooms.addRosterPack(room.id, "review-crew");
await drive.rooms.setAddress(room.id, { mode: "agents", agentIds: [reviewerId] });
```

`addRosterPack` expands through the kernel's pure `expandRosterPack`, and the resulting seating delta is committed by the host. The harness computed it; the hub wrote it. A participant seated by both a pack and a manual add carries two `seatSources`, so removing the pack does not evict them — the refcount is domain data, not a UI guess.

### Drive tab — reads only

```ts
import { reduceRoom, projectStage, projectRoster } from "@cline/drive";
import { parseDriveEvent } from "@cline/shared";

let snapshot = emptyRoom();

hubSocket.on("drive.event", (raw) => {
  snapshot = reduceRoom(snapshot, parseDriveEvent(raw));
  render({
    stage: projectStage(snapshot),
    roster: projectRoster(snapshot),
    addressSet: snapshot.addressSet,
  });
});
```

The webview imports the same reducer the hub uses, because `@cline/drive` builds for a browser target. There is one fold in the repository. The CLI TUI does the identical thing with different renderers, which is why the two surfaces cannot disagree about who is in the room.

### Agent runtime — untouched

`@cline/agents` keeps taking turns. The host binding subscribes to its session events and emits `work`-track Drive events for edits, commands, tests, plans, and decisions. The agent has no idea a room exists, and `ConfiguredAgent` YAML gains no Drive fields.

---

## 3. Mapping to the existing feature set

Every planned `DRV-*` feature resolves to exactly one layer. This table is the practical test of whether the layering holds — if a feature needs two owners, the boundary is wrong.

| Feature | Layer | Consumes |
|---|---|---|
| `DRV-EVENTS` | `@cline/shared` | — (it is the contract) |
| `DRV-KERNEL` | `@cline/drive` | shared schemas, type-only |
| `DRV-ROSTER`, `DRV-ROSTER-PACK` | `@cline/drive` pure expansion | `expandRosterPack`, `applySeatSourceDelta` |
| `DRV-ADDRESS` | `@cline/drive` pure | `resolveAddress` |
| `DRV-NARRATION`, `DRV-INTERRUPT` | `@cline/drive` pure | `narrate`, `classifyInterrupt` |
| `DRV-MODE-OVERLAY` | `@cline/drive` pure | `transitionDriveMode` |
| `DRV-AGENT-PROFILE` | `@cline/shared` schema + `@cline/drive` overlay resolution | appearance only, never prompts |
| `DRV-PLATFORM-CONFIG` | `@cline/shared` defs + `@cline/drive` merge + `@cline/core` IO | three-way split by lane |
| `DRV-ROOM-MVP`, `DRV-CALL-STRIP` | `@cline/core` hub commits + app render | `commitRoomOp`, projections |
| `DRV-STAGE`, `DRV-NOWNEXT` | app render over `projectStage` | — |
| `DRV-HOOK-POLICY` | `@cline/drive` decision + `@cline/core` mechanics | `applyPromptRewrite` |
| `DRV-CLI-PARITY` | app | same projections as the webview |
| `DRV-MIC`, `DRV-TTS`, `DRV-CAPTIONS` | host capability `voiceIo` | declared `false` in MVP |
| `DRV-SHARE`, WebRTC | deferred media plane | capability `pixelShare`, `false` everywhere |
| `DRV-TEAM-OPT` | Cline runtime | not a Drive concern; `RosterPack` is the Drive answer |

Two rows carry the load. `DRV-TEAM-OPT` stays in Cline runtime because a `Team` is an execution group and a `RosterPack` is a seating group — same-sounding, different domains, and collapsing them is the naming collision the vision already rejected. `DRV-AGENT-PROFILE` stays appearance-only because the moment a profile can carry a prompt, Drive owns agent definitions and Cline's `.cline/agents/*.yaml` becomes the second copy.

---

## 4. What changes in the existing plan documents

Small and contained.

1. **`../cline-drivemode/01-architecture.md`, package map** — split the row "Room, roster, stage ops, broadcasts → `@cline/core`" into the pure fold (`reduceRoom`, `projectStage` → `@cline/drive`) and the single-writer commit (`commitRoomOp`, `broadcast` → `@cline/core`). Rationale in [`02-architecture.md` §3.1](./02-architecture.md).
2. **`../cline-drivemode/features/DRV-KERNEL.md`** — add `DriveHostPort`, `HostCapabilities`, and the conformance kit to the package's surface, and add the purity gates from [`03-phased-plan.md` Phase 2](./03-phased-plan.md).
3. **`../cline-drivemode/README.md`** — pointer to this directory.

Nothing else moves. D1 through D7 stand. The hub stays the single writer. Events stay first. `RosterPack` stays `RosterPack`.

---

## 5. The failure this prevents

`cursor-drive/src/syncTypes.ts` and `claude-drive/src/syncTypes.ts` are the same file kept aligned by hand across two git roots, and both repositories' `AGENTS.md` instruct a human to "sync manually" when the other changes. That instruction is a standing admission that the contract has two owners.

`cline-drivecode` avoids repeating it not by writing a better instruction but by removing the second owner. `DriveEvent` is defined once, in one package, in one build graph, and every consumer reaches it through a dependency edge that `bun run build:sdk` and `bun run types` check. When a third host eventually wants the contract, it depends on a published package. That is the boundary at which copying becomes legitimate, and it is the only one.
