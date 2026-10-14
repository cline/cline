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
store. No shipped host provides UI slots (`registerUiHandler` and
`ctx.ui.push`) yet, so on every host, the `cline` CLI and the desktop app
included, served sets go to the session's debug log as ids and kinds. On a
host that provides them, sets stream to the tray slot: the desktop client's
chats start Next at once, and another slot client's chat records only its
last turn until a tray first asks for `current`.

## How it runs

When a chat starts, the plugin's `setup` builds that chat's runtime:

- the engine joins a hub that is already running (never starting one), folds
  hub events (`NodeHubClient` replays missed events with `sinceSequence` across
  socket reconnects in memory), and publishes `ui.notify` (rendered today by
  the menubar app) when this chat starts waiting on an approval or a question;
- with Next on, the Cline-first sources and the person's connectors join it,
  and so does Next itself, once the chat is active (see Install).

A chat set up with Next and notifications both off builds its runtime at the
first hook after either is turned on.

After each completed root run, `afterRun` serves the **rule-based set** at
once: one rule set for every host. The planner call then runs detached, on
the chat's own provider by default, and its set is served when it answers.
The person's next message is labelled against the set on screen from the
first `beforeModel` of the next run. Every served set and label goes to
`labels.jsonl` (schema v3) and the host's telemetry.

## Layout

| Directory | What it holds |
|---|---|
| [`src/hub/`](src/hub/link.ts) | The engine's single hub connection (it never starts a hub, never advertises a capability, and refuses to send `approval.respond` or `capability.respond`), the pure fold over an allowlist of hub events (ids, states and counts, never content), the seed commands run on every connect, and the fold's saved sequence |
| [`src/engine/`](src/engine/engine.ts) | One subscription, the live fold, seeding on connect, upcoming runs read again whenever a schedule changes or runs, and Needs-you notifications for its own chat |
| [`src/model/`](src/model/needs-you.ts) | The Status Hub model a host UI can render: session rows with their `report_status` rows, Needs you (approvals, questions, tasks awaiting approval, blocked or urgent status rows, and scheduled runs whose latest execution failed), schedules and teams |
| [`src/context/`](src/context/source.ts) | The source interface, the environment manifest, facts under per-tier budgets, source policy and redaction, and the Cline-first sources: the turn, git, repository commands, the person's Cline setup (names only), their other chats in this workspace, and the hub's tasks |
| [`src/connectors/`](src/connectors/index.ts) | Connectors over the connections the person already gave Cline; Next Turn never signs in to anything. GitHub reads through `gh`; MCP servers read only through pinned reads; Composio toolkits are Mention only until Cline exposes its Composio tools to plugins |
| [`src/planner/`](src/planner/next.ts) | Next: the rule set, the planner prompt, output invariants and its one bounded model call, the allowance, the label log and its telemetry mirror, one chat's sets and tray actions, and the tray protocol. The `plan` and `status` inputs have no host entry point yet, so both sources are absent outside tests |
| [`src/settings/`](src/settings/settings.ts), [`src/store/`](src/store/data-dir.ts) | The settings file and the planner's model choices; `<Cline data dir>/plugins/next-turn/` with atomic, owner-only writes, and each chat's tray state kept across sandbox idle reclaims |
| [`src/tasks/`](src/tasks/tasks.ts) | Tasks on the hub's agenda: edits, approve and cancel with the revision the person saw, and proposals written as spec files so they wait for approval |
| [`src/plugin.ts`](src/plugin.ts), [`src/runtime.ts`](src/runtime.ts), [`src/lifecycle.ts`](src/lifecycle.ts) | The plugin's hooks and `next` UI handler, none of which can fail the person's run; one chat's runtime; and the disable and uninstall check |
| [`src/contracts.ts`](src/contracts.ts), [`scripts/`](scripts/build.ts) | The published JSON Schemas, and the scripts that bundle the plugin and generate `contracts/` |

Tuning levers (timeouts, budgets, cadences, limits) live in
[`src/config.ts`](src/config.ts).

## Contracts

`contracts/` holds the generated JSON Schemas (`bun run contracts`;
`bun run check:contracts` fails on drift or on a file the generator would not
write). A host that renders the tray
natively codes against them; the wire between the plugin and a tray is
JSON, never an import.

## Verify

From this directory:

```sh
bun run build # bundle dist/index.js with host-aliased externals
bun run check # typecheck, contracts drift, and the full test suite
```

`cline plugin install` loads `src/index.ts`. `dist/index.js` is the
single-file bundle for a host that vendors the plugin; the dist test installs
that bundle into a clean Cline directory and holds its sandbox load to the
budget.

The tests need no running hub, key or network (one test starts an in-process
hub on 127.0.0.1):

- the hub link and the engine run against fake clients;
- the fold runs against recorded event shapes;
- settings, the cursor, the ledger and task specs use temporary directories;
- the planner runs against a fake model, and the plugin through the real SDK
  loader and a real `Agent` run;
- the rule set, label writer and redaction are held to golden fixtures in
  [`test-fixtures/`](test-fixtures/host-rules.json).
