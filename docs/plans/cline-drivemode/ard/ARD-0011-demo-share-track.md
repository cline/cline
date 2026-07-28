# ARD-0011: Demo share track (Cursor-like proof on the stage)

## Status

Proposed

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: D4, [DRV-SHARE](../features/DRV-SHARE.md), [DRV-STAGE](../features/DRV-STAGE.md), [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md), [09-demo-share.md](../09-demo-share.md), [share-and-router/PLAN.md](../share-and-router/PLAN.md)

## Context

DRV-SHARE already chose structured human share and deferred WebRTC. Users still need Cursor-style demo proof: browser screenshots and short recordings as reviewable stage artifacts, without standing up an SFU for the agent path.

## Decision

1. **ShareMode** is `structured | demo | pixel`. Pixel is reserved and unimplemented until multi-user media design.
2. **Demo artifacts** are discrete proof units (`DemoArtifactRef`) published as events (`drive_demo_frame`, later `drive_demo_clip`). Events carry metadata and URIs only, never inline media bytes.
3. **Stage** gains a demo track (last N artifacts) beside the work track (edit/command/test).
4. **Agent tools** align with Cursor browser / computer-use patterns (`drive_browser_snapshot`, optional clip record).
5. **Blobs are ephemeral by default.** Export is an explicit user act. Privacy forbidden-key tests extend to raw frame fields.
6. HostCapabilities add `demoCapture`, `demoRecord`, `structuredShare` (ISP).

## Consequences

**Positive**

- Matches how Cursor demos are reviewed (artifacts, not live streams).
- Preserves events-first stage and privacy defaults.
- Leaves WebRTC option open without forcing it.

**Negative**

- Not a continuous “see my desktop” share for agents.
- Needs blob mint/GC in the hub.

## Alternatives considered

- WebRTC pixel share as MVP — rejected (D4, SFU, privacy).
- Structured share only — rejected as sole answer for UI demos.
- Always-on agent desktop stream — rejected (continuous media plane).

## Links

- [09-demo-share.md](../09-demo-share.md)
- [share-and-router/PLAN.md](../share-and-router/PLAN.md)
