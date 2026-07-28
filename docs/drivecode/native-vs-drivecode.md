# Native Cline vs Drivecode

**Cline runs agents; Drive is a Cline mode that makes running them feel like being on a call.**

This page is a value comparison: what upstream Cline already ships versus what Drive mode adds. Every Drivecode row carries a maturity label so the claim stays honest. Integration goal: almost seamless—Drive enables features inside Cline, it is not a separate product ([PRD 8](../plans/cline-drivemode/prd/prd-drive-as-cline-mode.md), [ARD-0007](../plans/cline-drivemode/ard/ARD-0007-drive-as-cline-mode.md)).

Planning north star: [cline-drivemode](../plans/cline-drivemode/). Harness layer: [drivecode-sdk](../plans/drivecode-sdk/).

## Layering

Drive sits on Cline. It does not replace the agent loop, open a second daemon, or fork `ConfiguredAgent` YAML.

```mermaid
flowchart TB
  apps["Apps: Drive tab / Spotlight / Status Hub / Chat Join / CLI"]
  hub["Hub ws://127.0.0.1:25463 single writer"]
  drive["@cline/drive: propose policies reduceRoom projectStage"]
  core["@cline/core + agents: turns tools hooks ConfiguredAgent Team"]

  apps -->|"project only"| hub
  hub --> drive
  drive -->|"host commits"| core
```

Three verbs: **the harness proposes, the host commits, apps project.** See [04-relationship-to-cline-drivecode.md](../plans/drivecode-sdk/04-relationship-to-cline-drivecode.md).

## Maturity legend

| Label | Meaning |
|---|---|
| `plan` | Documented in `docs/plans/` only; no meaningful product code on the branch you run |
| `scaffold` | UI/CLI shell on the current workspace (Join call chrome, Drive status bar); little or no hub protocol |
| `branch` | Landed on this feature branch / PR — not necessarily merged to `main` yet |
| `shipped` | Present on `main` as a usable product surface |

## Value matrix

| Axis | Native Cline | Drivecode adds | Maturity | Primary refs |
|---|---|---|---|---|
| Interaction model | Turn chat: prompt → wait → transcript | Call room: join, roster, stay in the call | `branch` | [00-vision.md](../plans/cline-drivemode/00-vision.md); [DriveCallChrome.tsx](../../apps/cline-hub/src/webview/src/drive/DriveCallChrome.tsx) |
| WIP visibility | Transcript wall of tool output | Spotlight / stage cards (edit, command, test, plan, decision) | `branch` | [DRV-STAGE](../plans/cline-drivemode/features/DRV-STAGE.md); hub `Spotlight.tsx`, `stageReducer.ts` |
| Multi-agent | Team tools / mailbox (runtime groups) | Room roster, address set, RosterPack, recruit | `plan` | [DRV-ROSTER-PACK](../plans/cline-drivemode/features/DRV-ROSTER-PACK.md); [DRV-RECRUIT](../plans/cline-drivemode/features/DRV-RECRUIT.md); [ARD-0003](../plans/cline-drivemode/ard/ARD-0003-recruit-and-roster-pack.md) |
| Cross-agent status | Transient hub events; session lifecycle column | Durable Status Hub (`status.db`, Board + Changelog, `seq` cursor) | `branch` | Hub status views; Status Hub handlers on this branch |
| Interruptibility | Cancel / pending-prompt queue | Raise-hand pause-after-tool; mid-turn steer queue | `plan` | [DRV-INTERRUPT](../plans/cline-drivemode/features/DRV-INTERRUPT.md); [DRV-STEER-QUEUE](../plans/cline-drivemode/features/DRV-STEER-QUEUE.md) |
| Mode UX | Plan / Act | Drive mode on the same control family; postures Plan/Agent/Ask/Debug while Drive is on | `branch` | [DRV-MODE-OVERLAY](../plans/cline-drivemode/features/DRV-MODE-OVERLAY.md); [PRD 8](../plans/cline-drivemode/prd/prd-drive-as-cline-mode.md); [Chat.tsx](../../apps/cline-hub/src/webview/src/Chat.tsx) |
| Agent identity | `.cline/agents/*.yaml` (ConfiguredAgent) | `.driveagent/<slug>/` home + AgentProfile appearance overlay + recruit | `plan` | [ARD-0001](../plans/cline-drivemode/ard/ARD-0001-driveagent-home.md); [DRV-AGENT-PROFILE](../plans/cline-drivemode/features/DRV-AGENT-PROFILE.md) |
| Privacy | Session storage norms | Privacy-strict: no transcript/audio persist without explicit debug flag | `plan` | [DRV-PRIVACY](../plans/cline-drivemode/features/DRV-PRIVACY.md); [HANDOFF-drivecode.md](../plans/HANDOFF-drivecode.md) |
| Collaboration primitive | Session | Room: participants, stage sharer, addressSet | `branch` | [01-architecture.md](../plans/cline-drivemode/01-architecture.md) D3; hub `call_*` / `drive.*` |
| Host portability | Cline SDK only | `@cline/drive` host port + capability descriptor + conformance kit | `branch` | [02-architecture.md](../plans/drivecode-sdk/02-architecture.md); [DRV-KERNEL](../plans/cline-drivemode/features/DRV-KERNEL.md); `sdk/packages/drive` |
| Surface IA | Chat / CLI / IDE extension | Drive mode in Chat (+ optional Drive hub activity + Status Hub) | `branch` | [PRD 8](../plans/cline-drivemode/prd/prd-drive-as-cline-mode.md); [DRIVE-TAB.md](../design/drive-wireframes/DRIVE-TAB.md) |
| Media | N/A for coding-agent MVP | Events-first stage (typed work cards); WebRTC pixels later | `branch` | [00-vision.md](../plans/cline-drivemode/00-vision.md); [02-research-streaming.md](../plans/cline-drivemode/02-research-streaming.md) |

## What we deliberately reuse

Drivecode is an overlay, not a second product stack:

| Keep from native Cline | Drivecode rule |
|---|---|
| Hub on `:25463` | Single writer; nothing defaults to `:7891` |
| `ConfiguredAgent` / `.cline/agents/*.yaml` | Prompts, tools, skills, provider, model stay here |
| Cline `Team` | Runtime execution group — never rename to RosterPack |
| Hook engine | Drive policies decide; core applies |
| Pending-prompt / turn queue | Steer queue builds on existing primitives |
| Bundled ai-elements | Stage cards render with existing UI building blocks |
| Sessions / cron DBs | Status Hub is a separate `status.db`, not a rewrite of sessions |

## Naming firewall

| Drive word | Native word | Do not conflate |
|---|---|---|
| RosterPack | Team | Seating preset vs runtime group |
| AgentProfile | ConfiguredAgent | Appearance overlay vs behavior definition |
| Spotlight (UI) | `stage` (wire) | Product label vs protocol field |
| Room | Session | Collaboration unit vs agent turn container |

## Related links

- Vision: [00-vision.md](../plans/cline-drivemode/00-vision.md)
- Architecture: [01-architecture.md](../plans/cline-drivemode/01-architecture.md)
- SDK relationship: [04-relationship-to-cline-drivecode.md](../plans/drivecode-sdk/04-relationship-to-cline-drivecode.md)
- Repo handoff: [HANDOFF-drivecode.md](../plans/HANDOFF-drivecode.md)
