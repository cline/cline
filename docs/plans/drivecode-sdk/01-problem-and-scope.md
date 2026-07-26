# 01 · Problem and scope

Back to [README](README.md). Discovery input: [00-discovery-omnigent.md](00-discovery-omnigent.md).

## One sentence

**`drivecode-sdk` is a host-agnostic TypeScript meta harness for live pair-programming rooms: it owns the Drive domain model, the pure policies that run a call, and the adapter port that binds a room to whatever agent runtime is underneath, so the same product logic runs on Cline today and on another host later without a rewrite.**

## The problem, stated from evidence

Drive has now been designed three times.

`cursor-drive` built it as a VS Code extension with an MCP server on `:7891`. `claude-drive` built it again as a Node CLI over the Claude Agent SDK. `cline-drivecode` is designing it a third time over the Cline hub. The three share an operator registry, an intent router, a drive-mode state machine, a prompt pipeline, approval gates, worktree isolation, model tiering, and TTS.

Two of those three keep a file called `syncTypes.ts` that is maintained by **hand-copying between repositories**. Both `AGENTS.md` files say so in plain text.

> "Shared types and logic are kept in sync with the sibling CLI port `claude-drive`. When changing business logic here, mirror these files manually."
> `cursor-drive/AGENTS.md`

That is the problem in one line. The shared part of Drive is real, it is substantial, and today it is replicated by a human with a clipboard.

## Why "meta harness" is the right frame

Omnigent's thesis is that a layer above the agent harness owns composition, control, and collaboration, and cedes the agent loop to the harness underneath ([00-discovery-omnigent.md](00-discovery-omnigent.md)).

That maps onto Drive with unusual precision. Drive never wanted to own an agent loop. What Drive owns is:

- **Composition.** Several agents seated in one room, addressed individually or as a pack.
- **Control.** Interrupt, steer, mode, approval gates, permission presets.
- **Collaboration.** A room, a stage, a shared transcript, presence.

Those are exactly the three concerns Omnigent factors out, and none of them belongs inside Cline's turn loop.

The frame also tells us what **not** to build. Most of Omnigent's surface area is a multi-tenant server, OIDC, cloud sandbox providers, and a deployment matrix. Drive is single-user, local, and privacy-strict. Strip Omnigent down to the part that would survive those constraints and what remains is a domain model, a set of pure policies, and a narrow adapter contract. That residue is the entire product definition of `drivecode-sdk`.

## What has already been decided, and is binding

The `cline-drivemode` plan set is the north star and this SDK does not get to relitigate it. Binding constraints carried forward verbatim:

| Constraint | Source |
|---|---|
| The hub on `ws://127.0.0.1:25463` is the single writer of room state. No second daemon. Nothing defaults to `:7891`. | `docs/plans/cline-drivemode/01-architecture.md` D2 |
| Privacy-strict. No transcript or audio persistence without an explicit, visible debug flag. Events carry metadata, not raw media. | `docs/plans/cline-drivemode/00-vision.md` |
| Bun only. No npm, yarn, or pnpm. | `docs/plans/cline-drivemode/README.md` |
| `RosterPack`, never `Team`. `Team` is Cline's runtime execution group in `sdk/packages/core/src/extensions/tools/team/`. No Drive identifier contains `Team`. | `docs/plans/cline-drivemode/06-platform-config.md` |
| `AgentProfile` is an appearance overlay on `ConfiguredAgent`. Prompts, tools, skills, provider, and model ids stay in `.cline/agents/*.yaml` and are never copied into Drive config. | `docs/plans/cline-drivemode/01-architecture.md` D7 |
| The agent stage is events first. A derived last-event-wins projection over a versioned event union. No pixels on the agent path, no CRDT. WebRTC is later. | `docs/plans/cline-drivemode/01-architecture.md` D4 |
| Operators are not Cline teams. A seated participant is a Drive concept and does not imply a Cline execution group. | `docs/plans/cline-drivemode/06-platform-config.md`, sibling repos' operator registries |
| No Cursor or VS Code chrome DOM hacks. Hooks are the honest interception path. | `docs/plans/cline-drivemode/01-architecture.md` D5 |

## In scope

The SDK owns exactly four things.

**1. The domain model.** The typed shape of a call. `Room`, `Participant`, `SeatSource`, `AgentProfile`, `RosterPack`, `AddressSet`, `Stage`, and the versioned `DriveEvent` union. This is the `syncTypes.ts` problem solved once, in a package, instead of by hand across repositories.

**2. Pure policies and reducers.** Functions from state and input to a decision, with no IO. The Drive mode machine, the narration policy, the interrupt classifier, address resolution, pack expansion with refcounted seat sources, the stage reducer, and the facet catalog with its merge and tombstone rules.

**3. The host port.** One interface a host implements to bind a room to a real agent runtime, plus a **declared capability descriptor** so callers can branch on what a host actually supports rather than pretending every host is identical. This is the single most valuable thing copied from Omnigent.

**4. A conformance kit.** An executable suite that checks a host adapter's declared capabilities against its observed behavior. Omnigent ships this as `tests/harness_bench` and asks every harness contributor to run it. Without it, "host-agnostic" is an aspiration rather than a property.

## Out of scope, permanently

| Not in the SDK | Why |
|---|---|
| Transport of any kind. No websocket, no HTTP, no MCP server, no daemon. | The hub is the single writer and the only server. An SDK that opens a socket is a second daemon wearing a library's clothes. |
| Persistence. No file IO, no database, no config writing. | Boundary Discipline. The hub writes `.cline/drive/*.json` atomically and is the only writer. |
| UI. No React, no components, no rendering. | Surfaces render, never own state (`01-architecture.md` D6). |
| Prompt text, tool definitions, skills, provider config, model ids. | These belong to `ConfiguredAgent` and `.cline/agents/*.yaml`. Drive overlays appearance in a call and nothing else. |
| The agent loop and the LLM call. | Ceded to the host, exactly as Omnigent cedes it to the harness. |
| Multi-tenant server, accounts, OIDC, invite links, admin console. | Single user, local. This is most of Omnigent's code and none of our problem. |
| Cloud sandbox providers, OS sandboxing, egress proxying. | Windows-hostile, large, orthogonal. Git worktree isolation is the level Drive actually needs. |
| A Drive-owned agent definition format, YAML or otherwise. | Already rejected in `00-vision.md` non-goals and `01-architecture.md` alternatives. It forks `.cline/agents/` and guarantees drift. |
| Custom code policy handlers. | Databricks itself does not ship them on its managed deployment. A fixed set of typed declarative policies is safer and sufficient. |
| Evaluation and prompt optimization. | Not a shipped Omnigent concern either. Roadmap language, not a proven abstraction. |
| Telemetry. | Privacy-strict is a stated invariant. |

## Out of scope for now, but the shape must not foreclose it

- **A second host.** Cursor or Claude Code implementing the same port. The port must be designed as if this will happen, and the conformance kit is what keeps it honest, but no second adapter gets written in this plan.
- **Multiple humans in a room.** Participants already carry a `human | agent` kind. Adding humans must be adding participants, not rewriting the primitive.
- **WebRTC and media tracks.** Reserved with zero members, per `04-future-multi-user.md`. The SDK models a `Stage` with a `sharer` pointer and does not model pixels.
- **Voice.** Phase 3 in the drivemode task graph. The SDK may carry narration and caption event variants; it does not carry an STT or TTS engine.

## Definition of done for this planning wave

This wave is done when all of the following hold. Each is checkable by reading the artifacts, which is the point.

1. A one-sentence product definition exists that a reader can disagree with. **This document, above.**
2. The layer cake names every layer, and for each layer states what it writes, what it reads, and what it must never touch. [02-architecture.md](02-architecture.md).
3. Every domain type is assigned to exactly one owner, and the types the SDK must **not** own are listed by name with the reason. [02-architecture.md](02-architecture.md).
4. The relationship to the already-planned `@cline/drive` kernel is resolved to one of merge, rename, above, or below, with the losing options written out and rejected in prose. [02-architecture.md](02-architecture.md).
5. A package location is chosen, and the alternative is rejected against concrete evidence rather than taste. [02-architecture.md](02-architecture.md).
6. The phased plan has an acceptance criterion per phase that a machine or a reviewer can check, and no time estimates. [03-phased-plan.md](03-phased-plan.md).
7. Every open fork has a chosen default and an escape hatch. Nothing blocks on a human answer. [02-architecture.md](02-architecture.md) and [03-phased-plan.md](03-phased-plan.md).
8. No implementation code exists under any `packages/` directory, and nothing is committed.

## The failure mode this scope exists to prevent

The realistic bad outcome is not that the SDK is wrong. It is that the SDK is **a second copy of `@cline/drive`**, with a second event union, a second facet catalog, and a second registry, and that six months later somebody is hand-copying `syncTypes.ts` between `drivecode-sdk` and `sdk/packages/drive`.

That is precisely the failure already visible between `cursor-drive` and `claude-drive`. The architecture document treats avoiding it as the primary constraint, not as a nice-to-have.
