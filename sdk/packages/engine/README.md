# `@cline/engine`

Single-execution engine over the Cline agent loop — **Phase 1 of the Gateway
RFC** (see `sdk/packages/gateway/README.md` for the full design).

## What it owns

Exactly one execution:

- consumes an immutable [`RunSpec`](./src/run-spec.ts);
- drives the existing `@cline/agents` loop with `@cline/llms` handlers;
- binds caller-supplied tools, hooks, approval port, artifact sink, clock,
  and telemetry;
- emits canonical, ordered [`EngineEvent`](./src/events.ts) values
  (per-run `sequence` starting at 0);
- supports cooperative `steer(text)` (merges into the active run before the
  next model call), cooperative `interrupt(reason?)`, and hard
  `abort(reason?)`;
- returns an [`EngineRunResult`](./src/result.ts) plus persistence deltas
  the caller applies to its own stores.

## What it deliberately does not own

No database, config watcher, filesystem discovery, listener, daemon, global
singleton, connector, or process supervisor. Multiple engines run
concurrently without shared mutable module state.

These rules are machine-checked in [`src/boundaries.test.ts`](./src/boundaries.test.ts):
the engine never imports `@cline/bot`, `@cline/gateway`, or `@cline/core`,
and never imports storage, socket, or process-spawning modules.

## Usage

```ts
import { createEngine } from "@cline/engine";

const engine = createEngine(
	{
		runId: "run_abc12345",
		input: "summarize the diff",
		model: { kind: "provider", providerId: "anthropic", modelId: "claude-sonnet-4-5", apiKey },
		tools: [myTool],
		requestApproval: async (request) => ({ approved: true }),
	},
	{ clock, telemetry, artifacts },
);

engine.subscribe((event) => console.log(event.sequence, event.type));
engine.steer("also check the tests");
const result = await engine.run();
// result.persistence -> deltas for the caller's canonical stores
```

An engine owns exactly one execution — calling `run()` twice throws.
