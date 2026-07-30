# Leveraging the Drive harness (`@cline/drive`) vs `@cline/sdk`

Back to [README.md](README.md). Architecture: [02-architecture.md](02-architecture.md). Consumption: [04-relationship-to-cline-drivecode.md](04-relationship-to-cline-drivecode.md).

## Two SDKs (do not conflate)

| Package | Role |
|---|---|
| `@cline/sdk` | Alias for `@cline/core` — agent loop, sessions, tools, hub client |
| `@cline/drive` | Drive harness (role name **drivecode-sdk**) — rooms, stage, director policies, host port |

Product Drive surfaces (`apps/cline-hub`, CLI Drive chrome) should compose **`createDriveHarness` + `createClineDriveHost`**, not invent a second room API beside hub wire commands.

## What we were doing

| Pattern | Problem |
|---|---|
| Hub `drive.*` / `call_*` commands only | Second surfaces (CLI, tests, remote hosts) must clone the wire protocol |
| Pure helpers imported à la carte (`planRoute`, `pickNextShow…`) | Correct for policy; missing a composition root that commits through the host |
| `createClineDriveHost` unused by product | Port existed for conformance only; handlers reimplemented seating |
| Local webview `stageReducer` | Risk of a second fold vs `reduceRoom` / `projectStage` |

## What landed

- **`createDriveHarness({ host })`** — MVP rooms API: `createOrAttach`, `addRosterPack`, `setAddress`, `raiseHand`, `setSharer`, `setSubMode`, `setSpotlight`, `onEvent`
- **`RoomOp` carries `roomId`** on every op (multi-room safe)
- **`DriveHostPort.getRoom`** for pack/spotlight reads
- **`memoryDriveHost`** for kernel tests without a hub
- **`director.*`** on the harness exposes pure Show helpers (`pickNextShow`, `planRoute`, `planShowIntents`, `advanceScriptBeat`) — live backlog commit remains `drive.show.*` until a DirectorPort exists
- **Webview single fold** — `useDriveSession` folds `drive_event` via `foldIncomingDriveEvent` → `reduceRoom`; demo `stageReducer` maps tools → `work.*` → same fold

## How to use it

```ts
import { createDriveHarness } from "@cline/drive";
import { createClineDriveHost } from "@cline/core"; // hub binding

const host = createClineDriveHost({ configParent: workspaceRoot });
const drive = createDriveHarness({
  host,
  resolveRosterPack: async (packId) => { /* pack seats */ return []; },
});
await drive.start();

const room = await drive.rooms.createOrAttach({
  humanId: "drive:human",
  humanDisplayName: "You",
});
await drive.rooms.setAddress(room.roomId, {
  mode: "agents",
  agentIds: ["drive:partner"],
});
```

Apps still **project** with `reduceRoom` / `projectStage` / `projectRoster` from the same package — one fold.

## Recommended next leverage (ordered)

1. **Hub handlers call the harness** for join / address / stage instead of duplicating `joinCall` + store writes — single commit path.
2. **DirectorPort** on the host: `enqueueShow` / `tickShow` / `presentShow` / `attachScript` so Show backlog leaves `drive-handlers.ts` private functions.
3. **Webview**: fold `drive_event` with `reduceRoom` (retire dual `stageReducer` for live rooms; demos map tools → work events → same fold).
4. **Do not** dump all of `@cline/drive` into `@cline/sdk` root — keep agent vs room packages separate; optional future subpath `@cline/sdk/drive` only if publishing needs one install name.
5. Land missing Phase-2 pure helpers still named in the architecture (`expandRosterPack`, `capPreset`, `resolveAddress`) and wire `addRosterPack` to durable packs.

## Status

| Item | Status |
|---|---|
| `createDriveHarness` rooms MVP | Done |
| Host `getRoom` + roomId on `RoomOp` | Done |
| Product hub migration onto harness | **Partial** — `call_set_address` / `call_set_stage` / `call_set_mode` via `getHubDriveHarness` |
| DirectorPort / show commit on harness | **Partial** — `commitDirectorOp` + `DriveHarness.shows`; hub `drive.show.*` still publishes events |
| Webview single fold | **Done** — `foldIncomingDriveEvent` + tool→`work.*`→`reduceRoom` in `stageReducer` |
