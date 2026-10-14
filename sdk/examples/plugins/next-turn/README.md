# Next Turn

Next Turn is a Cline plugin that, after each completed turn, offers the
person up to three things they could say next — a suggestion tray fed by a
rule-based set first and, when a model is available, a planner set behind
it. It also carries Tasks helpers and a Status Hub model (session rows,
Needs you, schedules and teams) that a host UI can render.

This package is self-contained: it depends only on Cline's published
packages (`@cline/sdk`, `@cline/shared`, `@cline/core`, `@cline/llms`, all
optional peers) and Node builtins. Nothing here needs another repository.

## Install

```sh
cline plugin install ./sdk/examples/plugins/next-turn
```

After a completed run, look for `[next-turn] suggestions` in the session's
debug log, and for the set's records in
`<Cline data dir>/plugins/next-turn/labels.jsonl`. Remove it with
`cline plugin uninstall next-turn`, or turn it off in the host's plugin
settings.

Nothing submits a chat message on its own: Next's rule set needs no Status
store, and when the host provides a UI slot (`registerUiHandler` and
`ctx.ui.push`), sets stream to the tray slot; on hosts without slots,
served sets go to the session's debug log as ids and kinds.

## How it runs

When a chat starts, the plugin's `setup` builds that chat's runtime:

- the engine joins a hub that is already running (never starting one), folds
  hub events (`NodeHubClient` replays missed events with `sinceSequence` across
  socket reconnects in memory), and publishes `ui.notify` for the CLI when this
  chat starts waiting on an approval or a question;
- with Next on, the Cline-first sources and the person's connectors join it,
  and so does Next itself.

After each completed root run, `afterRun` serves the **rule-based set** at
once: one rule set for every host. The planner call then runs detached, on
the chat's own provider by default, and its set is served when it answers.
The person's next message is labelled against the set on screen from the
first `beforeModel` of the next run. Every served set and label goes to
`labels.jsonl` (schema v3) and the host's telemetry.

## Modules

| Module | What it does |
|---|---|
| [`src/config.ts`](src/config.ts) | Every lever: timeouts, budgets, cadences, file names |
| [`src/store/data-dir.ts`](src/store/data-dir.ts) | `<Cline data dir>/plugins/next-turn/`, resolved as Cline does (`CLINE_DATA_DIR`, `CLINE_DIR`, `~/.cline`); atomic, owner-only writes |
| [`src/settings/settings.ts`](src/settings/settings.ts) | The settings file: features, context sources, connector roles (Off · Mention · Read · Notify), planner model and allowance, per-workspace overrides |
| [`src/hub/link.ts`](src/hub/link.ts) | The engine's single hub connection. It never starts a hub, never advertises a capability, and refuses to send `approval.respond` or `capability.respond`. `@cline/core/hub` is imported on first use |
| [`src/hub/fold.ts`](src/hub/fold.ts) | A pure reducer over an allowlist of hub events: runs, failed tool calls, pending approvals and questions, tasks, schedule runs, team progress, cost. It keeps ids, states and counts, never content |
| [`src/hub/cursor.ts`](src/hub/cursor.ts) | The fold's last event-log sequence, saved on disk |
| [`src/context/`](src/context/source.ts) | The source interface, the environment manifest (each source present, unknown, absent or off, plus capability tags), facts collected under per-tier budgets, source policy, and redaction |
| [`src/context/sources/`](src/context/sources/index.ts) | The Cline-first sources: the turn, git, repository commands, the person's Cline setup (names only), their other chats in this workspace, and the hub's tasks and status |
| [`src/connectors/`](src/connectors/index.ts) | Connectors over the connections the person already gave Cline. Next Turn never signs in to anything. GitHub reads through `gh`; Composio toolkits and MCP servers read only through pinned reads, each result reduced to one redacted line |
| [`src/settings/models.ts`](src/settings/models.ts) | The planner's model choices: configured provider and model ids, never keys |
| [`src/hub/seed.ts`](src/hub/seed.ts) | The cold start: `session.list` and `task.list` fill what live events have not |
| [`src/model/session-rows.ts`](src/model/session-rows.ts) | Implicit status: one row per live session, with its `report_status` rows nested under it |
| [`src/model/needs-you.ts`](src/model/needs-you.ts) | Needs you: approvals, questions, tasks awaiting approval, and blocked or urgent status rows, ranked |
| [`src/model/schedules.ts`](src/model/schedules.ts) | Schedules and teams: the Upcoming lane, failed scheduled runs, and team rows |
| [`src/engine/allowance.ts`](src/engine/allowance.ts) | The planner's spend, appended to `planner.jsonl`, and the per-chat allowance over a rolling hour |
| [`src/tasks/tasks.ts`](src/tasks/tasks.ts) | Tasks on the hub's agenda: edits, approve and cancel with the revision the person saw, and proposals written as spec files so they wait for approval |
| [`src/engine/`](src/engine/engine.ts) | The engine: one subscription, the live fold, seeding on connect, and Needs-you notifications for its own chat |
| [`src/planner/`](src/planner/next.ts) | Next: the rule set ([`rules.ts`](src/planner/rules.ts)), the planner prompt and output invariants, one bounded model call through `@cline/core` and `@cline/llms`, the label log and its telemetry mirror, and one chat's sets and tray actions ([`next.ts`](src/planner/next.ts)). A host may supply a plan through the `PlanAdapter` in [`backlog.ts`](src/planner/backlog.ts); without one the `plan` source is absent |
| [`src/contracts.ts`](src/contracts.ts) | The published JSON Schemas: the label record, the manifest, and the tray slot's set, state push and actions |
| [`src/store/session-state.ts`](src/store/session-state.ts) | Per-session offer and pool state persisted across 30-minute sandbox idle reclaims |
| [`src/lifecycle.ts`](src/lifecycle.ts) | Fast disable/uninstall check against `global-settings.json` and the package root |
| [`src/runtime.ts`](src/runtime.ts) | One chat's runtime: hub link and engine, sources, connectors and their refresher, Next |
| [`src/plugin.ts`](src/plugin.ts) | The plugin: `setup` builds the runtime and registers the `next` UI handler; `beforeModel` and `afterRun` feed it, and none can fail the person's run |

## Contracts

`contracts/` holds the 5 generated JSON Schemas (`bun run contracts`;
`bun run check:contracts` fails on drift). A host that renders the tray
natively codes against them; the wire between the plugin and a tray is
JSON, never an import.

## Verify

From this directory:

```sh
bun run build # bundle dist/index.js with host-aliased externals
bun run check # typecheck, contracts drift, and the full test suite
```

The tests need no hub, key or network:

- the hub link and the engine run against fake clients;
- the fold runs against recorded event shapes;
- settings, the cursor, the ledger and task specs use temporary directories;
- the planner runs against a fake model, and the plugin through the real SDK
  loader and a real `Agent` run;
- the rule set, label writer and redaction are held to golden fixtures in
  [`test-fixtures/`](test-fixtures/host-rules.json).
