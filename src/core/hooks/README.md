# Cline Hooks

Cline Hooks are scripts that live in `.cline/hooks` which Cline executes at specific points of execution.

Currently there are just two hooks: PreToolUse and PostToolUse but more are planned.

## Hook Discovery

Hook discovery has two parts:

1. Find the hooks folder, which is in `.clinerules/hooks` in the workspace root, or `<global Cline rules folder>/hooks`.

Because workspaces can have multiple roots, we may find multiple matching hooks and will run them all in order.

2. Find a specific hook within the hooks folder.

Each hook has a name, for example `PreToolUse`. The hook is an executable at `.cline/hooks/PreToolUse`. For Windows, we want to use PATHEXT to find the various kinds of executable files Windows has (.bat, .cmd, etc.) This means we should execute in shell mode, but specify a path without an extension, so PATHEXT will be applied (but not PATH.) Note, if we're searching for specific programs, we may need to interpret PATHEXT.

Question for product: PATHEXT does not include .ps1. so we should consider making that work by executing PowerShell or just document that we're cmd-only?

## Input and Output

Hooks accept input as JSON on stdin and produce output on stdout.

Here's the common schema for hook input and output:

```proto
message HookInput {
  string cline_version = 1;
  string hook_name = 2;
  string timestamp = 3;
  string task_id = 4;
  repeated string workspace_roots = 5;
  string user_id = 6;
  oneof data {
    PreToolUseData pre_tool_use = 10;
    PostToolUseData post_tool_use = 11;
  }
}

message HookOutput {
  string context_modification = 1;
  bool should_continue = 2;
  string error_message = 3;
}
```

Here's the schema for the two hooks in particular:

```proto
message PreToolUseData {
  string tool_name = 1;
  map<string, string> parameters = 2;
}

message PostToolUseData {
  string tool_name = 1;
  map<string, string> parameters = 2;
  string result = 3;
  bool success = 4;
  int64 execution_time_ms = 5;
}
```

We use the same ts-proto approach that the webview-RPC system uses to define TypeScript types for these. However, unlike the webview-RPC, these types are part of the developer's interface to Cline and need to evolve carefully.

## Classes and Interfaces

HookRunner<Input> class
Responsibilities:
- Run the hook with extra input data of shape Input and produce HookOutput
- Times how long the hook ran, other metrics collection
Commentary:
- Abstracts the hook execution strategy so tests can run hooks without touching the filesystem

StdioHookRunner<Input> extends HookRunner<Input>
Data:
- Has a path to a specific script/executable
Responsibilities:
- Run the executable and manage its IO
- JSON serialization of parameters to HookInput and deserialization of results to HookOutput

NoOpHookRunner<Input>
Responsibilities:
- Always indicates execution should proceed.

CombinedHookRunner<Input>
Responsibilities:
- Given a homogeneous set of hooks, runs them and combines the result.
- If any hook indicates the hooks should stop, then the collective judgement is to stop.
- Context contributions from all hooks are combined by this class.
- Records the slowest hook, so we can let developers know why their hooks are slow.

HookFactory class
Responsibilities:
- Does any workspace root and filesystem watching necessary to discover hooks.
- Produces a hook of a given type (for example "PreToolUse"), on demand.
- When multiple workspaces are involved, combines hooks into a CombinedHookRunner.

## User Experience

We don't want to add noise to the UX. Most users don't care about hooks. Hook maintainers will want to dig in to check their hooks are running and inspect their output. So the UX should be:

- Add hook execution information in places that are not visible by default. For example, with the API Request disclosure triangle.

- When hooks are executing slowly, show something to the user to let them know hooks are running.

- When hooks have finished executing, show the user the slow hook and its execution time so they have a tiny bit of actionable information.

## Metrics

TBD

## Testing

We are pursuing test-driven development. You will implement tests first, which do not compile. I will verify this. Then stubs to verify that the tests compile but fail. Then working implementations. At each stage you will stop, explain the commands to run, and I will verify your work and provide feedback.

## Feature flags

Hooks should be controlled by a feature flag so we can land the code without shipping the feature until it is baked.

## Stability & Evolution

There will be more hooks over time. We need to make any hook components really easy to use. If we later want to puruse filesystem watching strategies we need to be able to support that without a do-over. Hooks need to be *really* easy for the Cline developers to use correctly.

Hooks are a programmatic interface to Cline. The design is deliberately very simple--any parallelism or optional results are handled on the hook side, not in Cline. Hooks which want to interact with Cline do so by calling back into Cline using the SDK. This means hook use in the core needs to be hardened against concurrent modification by the called hooks.

The shape and kind of data passed to hooks in JSON needs to be evolved carefully so Cline updates do not break hook users. This is unlike the host-UI message passing, which are versioned together and can simply change in lock-step.

## Non-goals:

When running multiple hooks, it would make sense to cancel in-progress hooks as soon as one fails. We will not implement that for now.