# DRV-DEMO-SHARE · Demo artifact share on the Call Stage

Back to [README](../README.md). Design: [09-demo-share.md](../09-demo-share.md), [ARD-0011](../ard/ARD-0011-demo-share-track.md). Plan: [share-and-router/PLAN.md](../share-and-router/PLAN.md).

## Problem / user value

Structured IDE events are not enough when the partner ships a UI. The stage should show Cursor-like demo proof (screenshots, later short clips) without WebRTC.

## Acceptance criteria

- `ShareMode` includes `demo` alongside `structured` (and reserved `pixel`).
- Agent (or human) can publish a `drive_demo_frame` with `DemoArtifactRef` metadata only.
- Stage demo track shows last N demo cards with caption; bytes load on demand from a short-lived URI.
- Blobs are ephemeral by default; export is explicit; schema forbids inline media bytes.
- No SFU / WebRTC required for this feature.
- HostCapabilities expose `demoCapture` (and later `demoRecord`) separately from `structuredShare`.

## Dependencies

- [DRV-STAGE](DRV-STAGE.md), [DRV-SHARE](DRV-SHARE.md), [DRV-EVENTS](DRV-EVENTS.md), [DRV-PRIVACY](DRV-PRIVACY.md), [DRV-CALL-STRIP](DRV-CALL-STRIP.md).

## Surfaces touched

- `sdk/packages/shared/src/drive/` (types, events)
- `sdk/packages/drive/` (stage reducer demo track)
- `sdk/packages/core/src/hub/` (blob mint/GC, publish ops)
- `apps/cline-hub/src/webview/src/` (Stage demo cards, tools)

## Agent tasks

- [ ] Land schemas + forbidden-key tests for demo events.
- [ ] Extend `reduceStage` with DemoTrack fixtures.
- [ ] Hub blob mint + `drive_browser_snapshot` (or host bridge) → stage card.
- [ ] Privacy checklist for ephemeral blobs.

## Risks

- Blob retention creep. Mitigation. Ephemeral default + visible debug flag only.
- Confusion with pixel share. Mitigation. Stage header labels `shareMode`.
