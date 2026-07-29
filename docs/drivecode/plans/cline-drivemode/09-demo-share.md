# 09 · Demo share track (Cursor-like proof on the stage)

Back to [README](README.md). Decision: [ARD-0011](ard/ARD-0011-demo-share-track.md). Feature: [DRV-DEMO-SHARE](features/DRV-DEMO-SHARE.md). Full plan: [share-and-router/PLAN.md](share-and-router/PLAN.md).

## Why

Pair calls need more than structured IDE events when the work is a UI. Cursor agents prove demos with **browser screenshots** and **computer-use video clips**, not a continuous SFU stream. Drive adopts that artifact model on the existing events-first stage.

## Share modes

| Mode | Meaning | Status |
|---|---|---|
| `structured` | Selection / file / terminal pin ([DRV-SHARE](features/DRV-SHARE.md)) | MVP |
| `demo` | Screenshot / short clip artifact cards on a stage demo track | This doc |
| `pixel` | WebRTC human↔human | Later ([04-future-multi-user.md](04-future-multi-user.md)) |

## Cursor → Drive map

| Cursor | Drive |
|---|---|
| Browser tool screenshot | `drive_demo_frame` event + blob ref |
| Computer-use video proof | `drive_demo_clip` (phase after frames) |
| PR artifact attachment | Stage demo card + optional user export |

**Anti-pattern.** Discord Go Live for the agent. That forces WebRTC early and fights D4.

## Types (sketch)

```ts
type ShareMode = "structured" | "demo" | "pixel";

type DemoArtifactRef = {
  artifactId: string;
  mediaKind: "screenshot" | "video_clip";
  uri: string;       // short-lived blob or export path
  caption: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: string;
};
```

Events stay metadata-only. Bytes are out-of-band. Schema forbidden keys still ban inline media dumps ([DRV-PRIVACY](features/DRV-PRIVACY.md)).

## Ownership

| Piece | Package |
|---|---|
| Schemas / events | `@cline/shared` |
| `reduceStage` demo track | `@cline/drive` |
| Blob mint/GC, stage ops | `@cline/core` hub |
| Capture tools + Stage UI | `apps/cline-hub` |

## Privacy

Ephemeral by default. Export is explicit. `privacy.debugRetention` may keep session blobs with a visible indicator.

## See also

- [10-agent-router.md](10-agent-router.md)
- [DRV-STAGE](features/DRV-STAGE.md), [DRV-SHARE](features/DRV-SHARE.md)
- [02-research-streaming.md](02-research-streaming.md)
