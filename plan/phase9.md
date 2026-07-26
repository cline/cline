# Phase 9 Handoff: Reliable Chat UX and Core Coding Workflows

## Goal

Make every agent run visibly active, cancellable, and diagnosable, then verify
that the retained coding tools work together as one streamlined workflow.

This phase combines:

- Step 13: improve chat reliability and feedback;
- Step 14: stabilize retained coding workflows.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 8 is complete and committed. Read `plan/scope.md`,
`plan/phase8.md`, and the applicable `AGENTS.md` files before editing.
Preserve unrelated user changes and retained user data.

## Keep the Architecture Small

Reuse:

- Phase 8 Bedrock target selection and automatic doctor;
- the existing Bedrock stream adapter and `AbortSignal`;
- the central approval policy from Phase 5;
- the existing session event stream;
- existing diff, terminal, browser, MCP, skill, and plugin services;
- the local logger that Phase 11 will extend.

Do not add:

- another provider or model abstraction;
- a second chat runtime;
- a second approval system;
- remote progress or telemetry;
- automatic retries that may repeat state-changing tools;
- a large job-queue framework.

## Part A: Define One Run Lifecycle

Represent a chat run with one explicit state:

```text
idle
submitting
awaitingFirstEvent
streaming
waitingForApproval
runningTool
cancelling
completed
cancelled
failed
```

Each active run must have:

- a local run ID;
- task/session ID;
- start time and current-stage start time;
- selected Bedrock invocation ID;
- current state;
- cancellation handle;
- sanitized failure details when applicable.

The extension host owns the authoritative state. The webview renders it and
must not infer completion from missing messages or timeouts.

## Part B: Immediate Feedback and Progress

When a user submits a prompt:

1. validate that Phase 8 is `ready`;
2. accept the prompt and assign a run ID;
3. immediately publish `submitting`;
4. publish `awaitingFirstEvent` after the Bedrock request is sent;
5. publish `streaming` on the first stream event;
6. publish tool and approval states as they occur;
7. publish one terminal state.

The UI should show:

- “Sending…” while submitting;
- “Waiting for Bedrock…” before the first event;
- streaming activity and elapsed time;
- the current tool name without dumping its full result;
- “Waiting for approval” when user action is required;
- “Cancelling…” after cancellation is requested;
- a clear completed, cancelled, or failed outcome.

Do not use fake percentage progress. Elapsed time and the real lifecycle state
are sufficient.

## Part C: Cancellation and Failure Handling

Cancellation must:

- be available from submission through streaming and tool execution;
- abort the Bedrock request through the existing signal;
- cancel queued prompts and cancellable local tools;
- be idempotent;
- stop accepting late events from the cancelled run;
- close open transient UI without deleting completed tool output;
- leave the chat ready for the next prompt.

If a non-cancellable external operation has already completed, record that
fact and stop subsequent agent work. Never claim that a completed mutation was
rolled back.

Failures must:

- publish a terminal `failed` state exactly once;
- preserve the Bedrock/AWS category, code, status, and request ID from Phase 8;
- identify stream, tool, approval, rendering, or persistence failures;
- provide retry only when doing so cannot duplicate a mutation;
- keep the conversation open.

Replace generic messages such as “agent run failed safely” with a short error
summary, expandable sanitized details, and an open-log action.

## Part D: Keep Tool Results Out of the Main Conversation

The main conversation should show:

- tool name;
- short status;
- affected file or command summary;
- approval state;
- success or failure.

Do not render complete command output, MCP payloads, search results, browser
results, or large diffs inline by default.

Provide an explicit expandable tool-result view or action that:

- loads the full retained result on demand;
- supports copy;
- clearly labels truncated output;
- preserves errors even when normal output is collapsed;
- does not send hidden output back to the model a second time.

Large tool results should be stored once and referenced by ID. Avoid duplicating
them in webview state, history projections, and React component props.

Likely UI/runtime areas include:

```text
apps/vscode/webview-ui/src/components/chat/
apps/vscode/webview-ui/src/components/chat/chat-view/
apps/vscode/src/sdk/sdk-session-event-coordinator.ts
apps/vscode/src/sdk/message-translator.ts
sdk/packages/core/src/services/agent-events.ts
```

## Part E: Stream and Rendering Performance

Keep token streaming responsive without rerendering the full conversation for
every token:

- batch adjacent text deltas for a short render interval;
- flush immediately at tool, approval, error, cancellation, and completion
  boundaries;
- update only the active message;
- virtualize or lazily render long histories where the existing UI supports
  it;
- avoid serializing complete history for each state change;
- unsubscribe stale listeners when the task changes;
- cap retained in-memory command/tool previews while keeping on-demand output
  accessible.

Measure:

- prompt acceptance to visible `submitting`;
- request sent to first Bedrock event;
- first event to first rendered text;
- cancellation request to terminal `cancelled`;
- webview responsiveness with one long conversation.

Measurements are diagnostic, not fixed release thresholds.

## Part F: Stabilize Plan and Act

Plan mode:

- may read workspace files and run bounded code search;
- may reason and propose changes;
- cannot edit files, run commands, mutate Git/worktrees, call state-changing
  MCP/plugin tools, or perform interactive browser actions.

Act mode:

- exposes retained state-changing tools;
- still requires the Phase 5 approval policy;
- never treats mode selection as approval.

Mode changes must not create a second session or lose the active conversation.

## Part G: Stabilize Read, Search, and Multi-File Editing

Read and search:

- operate only within allowed workspace boundaries;
- return bounded results;
- report inaccessible paths clearly;
- remain usable without approval.

Multi-file editing:

1. collect all proposed file changes into one patch set;
2. show a file summary and reviewable diff for every file;
3. require explicit approval before applying;
4. apply the accepted patch set consistently;
5. report partial failure precisely;
6. leave rejected files unchanged;
7. refresh the editor and Git state after application.

Reuse:

```text
apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts
apps/vscode/src/hosts/vscode/hostbridge/diff/
apps/vscode/webview-ui/src/components/chat/DiffEditRow.tsx
```

Do not reintroduce background or auto-approved edits.

## Part H: Stabilize Terminal, Browser, Web, MCP, Skills, and Plugins

Terminal:

- is absent when disabled;
- shows the exact command and working directory before approval;
- streams a bounded preview;
- retains full output on demand;
- reports exit code and cancellation.

Browser and web:

- allow bounded read-only web fetching without approval;
- require approval for interactive browser automation;
- show destination and action before approval;
- keep browser errors out of the main chat unless expanded.

MCP and plugins:

- load only configured local/user/workspace sources retained by Phase 5;
- require approval for each tool call;
- show server/plugin and tool names before approval;
- never restore marketplace installation or auto-approval.

Skills:

- remain local instruction sources;
- do not gain permission to bypass Plan mode or approvals.

## Implementation Order

1. Confirm Phase 8 is committed and the working tree is clean.
2. Add the single authoritative run lifecycle.
3. Wire immediate submission, waiting, streaming, approval, cancellation, and
   terminal-state events.
4. Reject late events and make cancellation idempotent.
5. Replace generic failures with structured local details.
6. Move full tool output behind an explicit on-demand view.
7. Batch stream rendering and remove duplicate history/tool-result copies.
8. Verify Plan/Act enforcement through the central approval policy.
9. Stabilize multi-file diff review and application.
10. Stabilize terminal, browser/web, MCP, skill, and plugin workflows.
11. Run focused coverage, package the VSIX, and complete the smoke matrix.
12. Commit Phase 9 independently.

## Minimal Automated Coverage

Keep coverage focused:

1. one table-driven run-lifecycle test covering success, failure,
   cancellation, and ignored late events;
2. one multi-file edit test proving no file changes before approval and
   correct reporting of a partial application failure;
3. one tool-result presentation test proving full results are hidden by
   default and retrievable on demand.

Reuse the Phase 5 approval-policy test. Do not create separate approval tests
for every tool.

## Required Commands

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

## Manual Acceptance

Using the packaged VSIX:

1. submit a prompt and immediately observe `submitting`;
2. observe waiting, streaming, and elapsed-time feedback;
3. cancel one request before the first event and one during streaming;
4. confirm both cancellations leave chat usable;
5. trigger one Bedrock failure and inspect actionable details;
6. run read and search in Plan mode;
7. confirm Plan mode rejects an edit and a command;
8. propose a two-file edit in Act mode, review both diffs, then approve;
9. reject one edit and confirm no change is applied;
10. approve one terminal command and inspect collapsed/full output;
11. run one read-only web fetch;
12. approve one browser action and one configured MCP tool;
13. confirm large tool results do not flood the main conversation.

## Done When

- every submitted prompt has an immediate visible state;
- every run reaches exactly one terminal state;
- cancellation is reliable and chat remains usable;
- failures are actionable and locally diagnosable;
- full tool results are hidden until requested;
- long streaming responses do not rerender the entire conversation;
- Plan and Act obey the central approval policy;
- multi-file edits are reviewable and never applied before approval;
- retained terminal, browser/web, MCP, skill, and plugin workflows work;
- required commands, focused tests, and manual acceptance pass.

## Commit

Suggested message:

```text
feat: stabilize chat lifecycle and coding workflows
```

The completion handoff should report:

- commit SHA;
- run-state implementation location;
- cancellation and late-event behavior;
- failure-detail and tool-result UX;
- basic latency measurements;
- multi-file editing result;
- retained-tool smoke results;
- required command and VSIX path.
