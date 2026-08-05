# goal

Adds a completion guard for Cline goals.

## What It Does

Registers a `/goal` slash command, a `mark_goal_complete` tool, a dynamic prompt rule, and completion hooks. When a run finishes while a goal is active, the plugin queues a follow-up prompt asking Cline to verify that the goal is actually complete. The nudge stops after Cline calls `mark_goal_complete`.

## Install

```bash
cline plugin install goal
```

For local development from this repository:

```bash
cline plugin install ./plugins/goal --cwd .
```

## Example Usage

In an interactive Cline session:

```text
/goal fix the failing CLI tests
```

The command sets the goal and submits `fix the failing CLI tests` as the task prompt. When Cline finishes, `goal` queues a verification prompt. If the goal is complete, Cline should call `mark_goal_complete` with a short summary. If it is not complete, Cline should continue working.

`mark_goal_complete` is only accepted after the verification prompt has been queued for that session. Calls during the initial work run return a structured refusal and leave the goal active.

Useful commands:

```text
/goal status
/goal off
```

## Requirements

- Cline plugin support.
- Write access to the Cline data directory.

## Notes

This pure plugin version uses a single pending goal because plugin slash command handlers do not currently receive the active session id. Once a runtime session claims the pending goal, the goal is tracked by session id. `/goal off` clears pending and active goals.
