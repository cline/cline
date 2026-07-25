# drivecode-sdk · Plan index

Planning only. No implementation lives here and none was written for this wave.

**`drivecode-sdk` is a host-agnostic TypeScript meta harness for live pair-programming rooms: it owns the Drive domain model, the pure policies that run a call, and the adapter port that binds a room to whatever agent runtime is underneath, so the same product logic runs on Cline today and on another host later without a rewrite.**

The product that consumes it is `cline-drivecode`, whose feature plan lives in [../cline-drivemode/](../cline-drivemode/). That plan is the north star. This folder adds the SDK layer beneath it and does not relitigate it.

Repo-level continuation brief. [HANDOFF-drivecode.md](../HANDOFF-drivecode.md).

## Documents

| File | What it holds |
|---|---|
| [00-discovery-omnigent.md](00-discovery-omnigent.md) | What Databricks' Omnigent means by "meta harness", with citations. Core abstractions, the runner and server split, the harness capability matrix, policies. Lessons kept and discarded. |
| [01-problem-and-scope.md](01-problem-and-scope.md) | Why a meta harness at all. The hand-copied `syncTypes.ts` evidence. What is in scope, out of scope permanently, and deferred. Definition of done. |
| [02-architecture.md](02-architecture.md) | The layer cake, the host port with its capability descriptor, the ownership matrix, the data shapes, and the resolution of `drivecode-sdk` against the planned `@cline/drive` kernel. |
| [03-phased-plan.md](03-phased-plan.md) | Phases with verifiable acceptance criteria. No time estimates. |
| [04-relationship-to-cline-drivecode.md](04-relationship-to-cline-drivecode.md) | How the product consumes the SDK and the Cline SDK together. What changes in the existing drivemode plan. |
| [decisions.tsv](decisions.tsv) | The decision trail for this wave. One row per decision, with evidence pointers. |

## Reading order

Read [01-problem-and-scope.md](01-problem-and-scope.md) first if you want to know whether this layer should exist. Read [02-architecture.md](02-architecture.md) first if you have already accepted that it should and want to argue about the boundaries. Read [00-discovery-omnigent.md](00-discovery-omnigent.md) only if you want the evidence behind the word "meta harness".

## The answer, in short

**`drivecode-sdk` and the already-planned `@cline/drive` kernel are the same package.** The kernel at `sdk/packages/drive` grows a host port, a capability descriptor, and a conformance kit. Nothing new is created beside it, and no separate repository is created at all.

Inside the monorepo the package id stays `@cline/drive`, because `DRV-KERNEL` and the `01-architecture.md` package map already name it that. `drivecode-sdk` is the role that package plays — the portable Drive harness — and would only become a literal package name if it were ever published for an out-of-tree host.

Three verbs summarise the layering. **The harness proposes. The host commits. Apps project.** Every "where does this go?" question resolves by asking which verb applies.

Two things change in the existing drivemode plan, both small and both argued in [02-architecture.md §3.1](02-architecture.md) and [04 §4](04-relationship-to-cline-drivecode.md): the room reducer and stage projection move from `@cline/core` to `@cline/drive` so the webview can import them instead of writing a second copy, and `DRV-KERNEL` gains the port and the conformance kit. D1 through D7 stand.

## Constraints inherited from cline-drivemode

These are binding here and are not up for renegotiation in this folder.

- The hub on `ws://127.0.0.1:25463` is the single writer of room state. No second daemon. Nothing defaults to `:7891`.
- Privacy-strict. No transcript or audio persistence without an explicit visible debug flag.
- Bun only.
- `RosterPack`, never `Team`. `Team` is Cline's runtime execution group.
- `AgentProfile` is an appearance overlay on `ConfiguredAgent`. Prompts, tools, skills, provider, and model ids stay in `.cline/agents/*.yaml`.
- Events-first stage. WebRTC is later.
- Operators are not Cline teams.
- No timeframes in plans.

## How this wave was run

Three playbooks were combined because no single one fits. **Investigation** governed the read-only research. **figure-it-out** governed the rigor level and the audit trail, because this is cross-cutting platform work that a human reviews after stepping away. The **multi-phase plan** reference governed the shape of the output.

Read-only exploration was delegated to subagents so the main thread kept summaries rather than raw file dumps. The one genuinely contested question, where the SDK boundary falls relative to the already-planned `@cline/drive` kernel, went through a design arena with three independent candidates and a separate cross-judge, because a package boundary is a one-way door. Two candidates said merge, one said sits above; the dissent's central argument — that a host port violates the kernel's purity constraint — does not survive the observation that `DriveHostPort` is an interface with no implementation, and declaring an effect is not performing one.

Two honest caveats. The exploration subagents had not returned by the time these documents were written, so the grounding came from the parent reading the binding plan files directly rather than from delegated summaries. And Phases 1 and 2 of the plan have static verification only — the first runtime evidence for the whole design arrives in Phase 3, which is called out in [03-phased-plan.md](03-phased-plan.md) rather than papered over.

The full trail with evidence pointers is in [decisions.tsv](decisions.tsv).
