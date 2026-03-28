# Agent Runtime Assessment

## Scope
This assessment focuses on the current runtime support pattern behind the user's framing of "Agent Runtime" for:
- `cline`
- `claude-code`
- `openai-codex`

It then evaluates whether `kiro cli` can be added as another runtime in the current architecture.

## Current Structure

### 1. There is no single pluggable `AgentRuntime` interface today
The current codebase does not expose a dedicated `AgentRuntime` abstraction such as:
- `registerRuntime()`
- `RuntimeAdapter`
- `CliRuntimeProvider`

Instead, runtime-like integrations are implemented as full `ApiProvider` additions, which must be wired through several layers:
- Provider identity in [`src/shared/api.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/api.ts)
- Persistent config fields in [`src/shared/storage/state-keys.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/storage/state-keys.ts)
- Proto conversion in [`src/shared/proto-conversions/models/api-configuration-conversion.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/proto-conversions/models/api-configuration-conversion.ts)
- Handler construction in [`src/core/api/index.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/core/api/index.ts)
- Provider-specific handler in [`src/core/api/providers/`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/core/api/providers/)
- Settings UI in [`webview-ui/src/components/settings/ApiOptions.tsx`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/webview-ui/src/components/settings/ApiOptions.tsx) and provider components
- Config validation in [`webview-ui/src/utils/validate.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/webview-ui/src/utils/validate.ts)
- Configured-provider visibility in [`webview-ui/src/utils/getConfiguredProviders.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/webview-ui/src/utils/getConfiguredProviders.ts)
- Provider labels in [`src/shared/providers/providers.json`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/providers/providers.json)

### 2. The three "runtime" examples are implemented differently

#### `cline`
- `cline` is a first-class provider in the `ApiProvider` union.
- It is not an external CLI bridge in the same sense as Claude Code.
- It behaves more like a native provider integrated with the application's own account and model-selection flows.

#### `claude-code`
- `claude-code` is the closest match to an external agent runtime integration.
- The provider stores a CLI path (`claudeCodePath`) in settings.
- The handler [`src/core/api/providers/claude-code.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/core/api/providers/claude-code.ts) delegates execution to [`src/integrations/claude-code/run.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/integrations/claude-code/run.ts).
- That integration shells out to a local CLI (`claude` by default) with a non-interactive invocation pattern and consumes streamed machine-readable output.
- The handler translates external CLI output back into Cline's internal `ApiStream`.

#### `openai-codex`
- `openai-codex` is not implemented as a local external CLI runtime.
- It is implemented as a direct provider-specific API handler with OAuth in [`src/core/api/providers/openai-codex.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/core/api/providers/openai-codex.ts).
- This means Codex support demonstrates provider extensibility, but not CLI-runtime extensibility.

## Effective Runtime Extension Pattern

For an external runtime similar to Claude Code, the current architecture expects this shape:

1. Add a new provider ID to `ApiProvider`
2. Add any required settings fields
3. Add model catalog and default model IDs if model selection is static
4. Add provider mapping in proto conversions
5. Add a provider handler in `src/core/api/providers`
6. Add an integration runner in `src/integrations/<runtime>`
7. Translate the runtime's output into `ApiStream`
8. Add settings UI and validation
9. Add configured-provider detection
10. Add tests for the handler and runner

This is workable, but it is not low-friction plug-in architecture.

## Feasibility Of Adding `kiro cli`

## Verdict
- **Architecturally feasible**: Yes
- **Low effort**: No
- **Most likely implementation pattern**: Follow the `claude-code` integration model, not the `openai-codex` model

## Why it is feasible
The repository already contains one strong precedent for wrapping an external coding-agent CLI:
- `claude-code`

That precedent proves the system can:
- store an external CLI path
- invoke the CLI non-interactively
- inject system prompt and conversation history
- consume machine-readable streaming output
- translate external tool calls and assistant messages into internal stream events

If `kiro cli` supports a comparable execution mode, then integration is structurally possible.

## Main gating questions
Adding `kiro cli` is feasible only if the external runtime supports most of the following:

### A. Non-interactive invocation
The runtime must support being called from `execa()` or equivalent without an interactive TUI requirement.

### B. Prompt injection
The runtime must accept:
- a system prompt
- conversation history
- optional model/runtime options

### C. Machine-readable output
The runtime should emit JSON, NDJSON, or another deterministic structured stream.

### D. Tool-call observability
If the runtime internally performs tools, the integration needs enough detail to map them to:
- text
- reasoning
- tool call start/update/end
- usage or cost events

### E. Auth and environment stability
The runtime must allow auth through:
- environment variables
- local config files
- pre-established login state

without forcing an interactive browser flow during every request.

## Major risks

### 1. No generic runtime abstraction
Because the codebase is provider-centric, `kiro cli` support will touch many files. This raises implementation and maintenance cost.

### 2. Output contract mismatch
Claude Code integration works because the external CLI exposes a stream format that can be parsed incrementally. If Kiro only renders terminal text, integration quality will be weak and brittle.

### 3. Tool semantics mismatch
If Kiro's runtime uses tool semantics that do not resemble current `ApiStream` expectations, substantial translation code will be needed.

### 4. Prompt-size and transport limits
Claude Code already contains defensive handling for long system prompts. A Kiro integration may need the same class of safeguards.

### 5. Authentication model mismatch
If Kiro requires device login, web login, or opaque session state in a way that cannot be checked or refreshed programmatically, user experience will degrade.

## Minimum change set for a `kiro cli` runtime

### Required core changes
- Add `"kiro-cli"` or equivalent provider ID in [`src/shared/api.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/api.ts)
- Add config fields such as `kiroCliPath` and any auth/config path in [`src/shared/storage/state-keys.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/storage/state-keys.ts)
- Extend proto mappings in [`src/shared/proto-conversions/models/api-configuration-conversion.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/proto-conversions/models/api-configuration-conversion.ts)
- Add provider label in [`src/shared/providers/providers.json`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/shared/providers/providers.json)
- Add handler selection in [`src/core/api/index.ts`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/src/core/api/index.ts)

### Required runtime adapter changes
- Create `src/core/api/providers/kiro-cli.ts`
- Create `src/integrations/kiro-cli/run.ts`
- Optionally create a message filter or output parser similar to Claude Code

### Required UI changes
- Add `KiroCliProvider` settings component
- Add configuration validation
- Add provider visibility logic in configured-provider detection
- Add model picker integration if Kiro exposes explicit model IDs

### Required test changes
- Unit tests for the runner and stream parser
- Handler tests similar to `claude-code.test.ts`
- UI validation tests if new config behavior is introduced

## Recommendation

### Short answer
`kiro cli` can be added, but only as a **new provider-style integration**, not as a simple runtime registration.

### Best path
If the goal is to move faster and support multiple external coding CLIs in the future, the better long-term step is:
1. Extract a reusable external-runtime adapter contract from the current `claude-code` implementation
2. Make `claude-code` the first adapter using that contract
3. Add `kiro cli` as the second adapter

### Suggested abstraction target
A future abstraction could look like:
- `ExternalAgentRuntimeAdapter`
- `buildRuntimeInvocation()`
- `parseRuntimeStream()`
- `mapRuntimeToolEventToApiStream()`

That would reduce the cost of supporting:
- Claude Code
- Kiro CLI
- future external agent CLIs

## Conclusion
Based on the current repository structure, adding `kiro cli` is **possible**, but the present architecture is **provider-centric rather than runtime-pluggable**.

The decisive factor is not the control plane itself. The decisive factor is whether `kiro cli` offers a stable non-interactive and machine-readable runtime contract comparable to the current Claude Code integration.

If it does, implementation is realistic.

If it does not, the integration will become fragile very quickly.
