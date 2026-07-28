# 14 · Primitives / dead-code audit (P0)

Back to [README](README.md). Parent plan: upgrade + primitives audit.

**Method.** Ripgrep + file review of Drive/hub path after hub-ops bridge. Severity: High / Med / Low. Status at scan time.

## Canonical primitives (prefer these)

| Primitive | Home |
|---|---|
| `DRIVE_PARTICIPANT_HUMAN` / `DRIVE_PARTICIPANT_PARTNER` | `apps/.../drive/types.ts` |
| `DriveRoomLiveState` | `@cline/shared` `roomLive.ts` |
| `ShowBacklogItem`, `DirectorScript`, `ParticipantAudioFlags` | `@cline/shared` `director.ts` |
| `AddressSet`, `RoutePlan` | `@cline/shared` `router.ts` |
| `planRoute` / `assertDeliveryAllowed` / `rankShowBacklog` | `@cline/drive` |
| `drive.*` hub commands / events | `@cline/shared` hub.ts + core drive-handlers |
| `postToHost({ type: "driveCommand" })` | webview protocol |
| Zod `safeParse` at hub boundaries | drive-handlers `show.present` |

## Findings

| Sev | Finding | Location | Remedy | Status |
|---|---|---|---|---|
| High | Soft-widen to everyone when seated | `planRoute` | Fall back to pair_partner | **Fixed** earlier |
| Med | Legacy `"human"` / `"partner"` string compares beside `drive:*` ids | `DriveCallChrome`, `StickyStagePane`, `useDriveSession` | Normalize via helper `isHumanSpotlightId` / only constants | **Fix in this pass** |
| Med | Sticky pane not always fed from hub until present event | `StickyStagePane` + session | Bridge landed; keep single source from `presentedShow` | Open (improve) |
| Med | Chat.tsx still large | `Chat.tsx` | ConversationPanel + PendingApprovals + chatMessageState | **Fixed** (~957 lines) |
| Low | `createVoiceStack` JSON.stringify backend match | `createVoiceStack.ts` | Compare typed fields instead of stringify | **Fixed** (`sttBackendsEqual` / `topologyCacheKey`) |
| Low | Empty seated → `everyone` in planRoute | `planRoute.ts` | OK when no agents; document | Accepted |
| Low | Mermaid producer is SVG stub not layout engine | `produceMermaid.ts` | Optional webview re-render; or lazy mermaid in core later | Accepted MVP |
| Info | Pass-through re-exports in drive index | `drive/src/index.ts` | Keep as public API surface; not dead | OK |

## Misuse patterns to keep hunting (P1+)

```text
rg -n '"human"|"partner"' apps/cline-hub/src/webview/src/drive
rg -n 'as ShowBacklogItem|as DriveRoom' sdk/packages
rg -n 'mode: \"everyone\"' sdk/packages/drive
rg -n 'createVoiceStack\(' apps/cline-hub
```

## Dead-code candidates (confirm before delete)

- Duplicate voice helpers if any after `useDriveSession` extraction — **none found** (driveVoiceUi still used)
- Unreferenced exports in `@cline/drive` after API stabilizes — public surface; keep
- Legacy docs claiming Web Speech as local-safe default (already amended in topology docs)
- `produceMermaidShowArtifact` was exported but unused by handlers — **wired** via `materializeShowItem` on `drive.show.present`
- Removed unused `__getDriveRoomForTests` + `ParticipantAudioFlags` re-export from drive-handlers

## Next (P2+)

1. ~~Further Chat.tsx split~~ **P3 done** (~957 lines)  
2. U4 AI SDK major / U5 lucide 1.x as dedicated PRs  
3. **P4** unit guard: `planRoute.test.ts` bans `everyone` when seated
