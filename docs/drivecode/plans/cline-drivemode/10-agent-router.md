# 10 · Agent router (multi-agent room delivery)

Back to [README](README.md). Decision: [ARD-0012](ard/ARD-0012-agent-router.md). Feature: [DRV-AGENT-ROUTER](features/DRV-AGENT-ROUTER.md). Full plan: [share-and-router/PLAN.md](share-and-router/PLAN.md).

## Why

[DRV-ADDRESS](features/DRV-ADDRESS.md) lets a human pick recipients. In a room with several seated agents, every turn should not require manual chips. The router plans delivery to the **best seated agent** (or splits one utterance into slices for different agents).

## Verbs (do not conflate)

| Verb | Feature |
|---|---|
| Who to **seat** | [DRV-RECRUIT](features/DRV-RECRUIT.md) |
| Who gets this **utterance** | **This doc** |
| Manual chips | [DRV-ADDRESS](features/DRV-ADDRESS.md) |
| Spawn specialist | [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) |

## Modes

| Mode | Behavior | Default |
|---|---|---|
| `manual` | Chips only | Single-agent rooms |
| `suggest` | Router fills chips + reasons; human confirms send | **Multi-agent rooms** |
| `auto` | Router commits on send; low confidence falls back to suggest | Opt-in |

Facets: `router.mode`, `router.allowFractions` (default off), `router.threshold`.

## Types (sketch)

```ts
type RouteSlice = {
  sliceId: string;
  start: number;
  end: number;
  text: string;
  addressSet:
    | { mode: "everyone" }
    | { mode: "agents"; agentIds: string[] }
    | { mode: "pack"; packId: string };
  score: number;
  reasons: string[];
};

type RoutePlan = {
  utteranceId: string;
  mode: RouterMode;
  slices: RouteSlice[];
  lowConfidence: boolean;
};
```

## Pure API

```ts
// @cline/drive
planRoute({ utterance, seated, allowFractions, threshold }): RoutePlan
assertRouteLegal(plan, seatedIds): { ok: true } | { ok: false; code; message }
```

MVP scorer: lexical/tag overlap on seated agents’ capability labels (recruit spirit, seated-only). Emits only valid DRV-ADDRESS shapes. Never silent-widen empty → everyone.

## Delivery

Hub applies each slice through existing address enforcement. Multi-slice sends share `utteranceId` / `routePlanId` for transcript grouping.

## Ownership

| Piece | Package |
|---|---|
| RoutePlan schemas | `@cline/shared` |
| `planRoute` / assert | `@cline/drive` |
| Send-time apply + deliver | `@cline/core` hub |
| Preview chips UI | `apps/cline-hub` |

## See also

- [09-demo-share.md](09-demo-share.md)
- [share-and-router/PLAN.md](share-and-router/PLAN.md)
