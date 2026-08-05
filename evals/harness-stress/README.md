# Cline Harness Stress Endpoint

This local OpenAI-compatible endpoint makes SDK and client failures reproducible. It stresses streaming, cancellation, tool-call parsing, command dispatch, memory, and event-loop behavior. It does not ask a model to invent shell commands.

See [INCREMENTAL-UPDATES.md](INCREMENTAL-UPDATES.md) for a walkthrough of the first pressure finding, an exact replay command, profiling suggestions, and a cross-platform comparison procedure.

The endpoint emits only one command: a fixed Node callback to the endpoint itself. With auto-approval enabled, its trace measures these useful boundaries:

1. `tool_call_started`: the server sent the first tool-call bytes.
2. `tool_arguments_complete`: the server sent the complete fixed command.
3. `stream_finished`: the model response ended.
4. `command_callback_received`: the launched command reached user code.
5. The next `completion_request_received`: Cline submitted the tool result and continued the turn.

The fourth timestamp is an upper-bound command-start marker, not the exact OS process-spawn instant. The gap includes client parsing, approval, dispatch, process startup, and Node startup. Add client-side phase timestamps after this trace identifies which gap needs finer resolution.

## Start

From the repository root:

```bash
npm --prefix evals run harness:serve -- --trace-file harness-trace.jsonl
```

Configure Cline with:

- Provider: OpenAI Compatible
- Base URL: `http://127.0.0.1:4319/v1`
- API key: any non-empty value, such as `harness`
- Model: one of the IDs returned by `GET http://127.0.0.1:4319/v1/models`

Enable auto-approval for `run_commands`, submit any prompt, and inspect stdout, the JSONL trace, or `GET /__harness/traces`.

## Scenarios

| Model | Pressure |
|---|---|
| `harness/baseline` | One normally streamed safe callback |
| `harness/fragmented-tool-call` | Tool arguments split into one-character SSE chunks |
| `harness/slow-chunks` | Delay between every tool-call chunk |
| `harness/stall-after-tool-start` | Open connection that stops producing bytes |
| `harness/disconnect-after-tool-start` | Abrupt socket close during a tool call |
| `harness/burst-output` | Large text response streamed as a tight burst |
| `harness/repeated-safe-tools` | Repeated callback calls across model turns |

Tune pressure with environment variables:

```text
CLINE_HARNESS_BURST_BYTES=4194304       # 1 byte to 64 MiB
CLINE_HARNESS_FRAGMENT_DELAY_MS=5       # 0 to 10 seconds
CLINE_HARNESS_SLOW_CHUNK_DELAY_MS=1000  # 0 to 60 seconds
CLINE_HARNESS_REPEATED_TOOL_CALLS=20    # 1 to 1000
```

Each trace event contains a sequence number, ISO wall-clock timestamp, monotonic elapsed time, RSS/heap/external memory, and event-loop mean/max/p99 delay.

## Deterministic replay

Replay models encode a complete, versioned scenario snapshot:

```text
harness/replay-<canonical base64url scenario spec>
```

The token fixes the scenario, seed, UTF-8 payload size, chunk boundaries, delay plan, rounds, and parallel tool-call count. Replaying the same token on the same harness version produces byte-identical SSE, including across separate server processes. Scheduling jitter and client timing are measured rather than claimed deterministic.

Every completion response includes:

- `x-cline-harness-replay`: canonical replay token
- `x-cline-harness-fingerprint`: short scenario fingerprint

Every matrix result includes an executable replay command. Extreme replay tokens still require `--allow-extreme`; encoding a large value does not bypass the safety gate.

## Pressure matrix

Run the real `@cline/llms` OpenAI-compatible adapter against deterministic profiles:

```bash
# Fast contract and pressure coverage
npm --prefix evals run harness:matrix -- --profile ci --output matrix-ci.json

# Larger payloads and tool-call counts
npm --prefix evals run harness:matrix -- --profile large --output matrix-large.json

# Maximum bounded cases; explicit opt-in required
npm --prefix evals run harness:matrix -- --profile extreme --allow-extreme

# Replay one result exactly
npm --prefix evals run harness:matrix -- --model harness/replay-...
```

The endpoint enforces the same gate. Start it with `--allow-extreme` before selecting an extreme replay model:

```bash
npm --prefix evals run harness:serve -- --allow-extreme
```

Executable replay tool calls use the documented `http://127.0.0.1:4319` callback endpoint. Start tool replays on the default port so their byte-stable callback remains runnable. The provider-only matrix may use an ephemeral port because it parses but never executes tools.

Protocol correctness is pass/fail. Pressure budgets are separate alerts. Defaults flag scenarios exceeding 2 seconds or 256 MiB sampled peak RSS delta:

```bash
npm --prefix evals run harness:matrix -- --profile ci --fail-on-alert
npm --prefix evals run harness:matrix -- --profile ci \
  --max-duration-ms 1000 --max-peak-rss-mib 192 --fail-on-alert
```

The provider matrix verifies streaming and tool-argument reconstruction but does not execute tools. In particular, an `editor-old-text` pass proves the provider boundary handled the payload; reproducing edit-matcher or diff-preview CPU requires an isolated IDE fixture containing matching or ambiguous file content.

### Pressure axes

| Scenario | Boundary stressed |
|---|---|
| `text` | Assistant text size and model-delta count |
| `tool-arguments` | Incremental JSON/tool-argument assembly |
| `editor-old-text` | Real editor schema with large replacement context |
| `parallel-tools` | Multiple native tool calls in one model turn |

The hard limits are 64 MiB payloads, 262,144 payload chunks, 128 parallel calls, and 1,000 rounds. The provider-only matrix rejects multi-round specs because it does not execute tools or send continuations; replay those through a real IDE/CLI host.

## Safety and host boundaries

- The server binds to loopback by default. `--allow-remote --host <address>` is required for another interface.
- Prompts and request bodies cannot change the emitted command.
- The command only performs an HTTP request to the marker endpoint.
- For VS Code Remote or containers, run the endpoint in the extension host's network namespace or tunnel it. The callback needs Node 22+ in the command environment.
- `burst-output` can intentionally consume substantial client memory. Start with the default and raise it deliberately.

## Validate

```bash
npm --prefix evals run harness:test
npm --prefix evals run harness:smoke
npm --prefix evals run harness:provider-smoke
```
