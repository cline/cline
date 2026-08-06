# Incremental model-update amplification

## Finding

The OpenAI-compatible provider path becomes disproportionately expensive when a modest response arrives as a very large number of tiny SSE updates.

On Windows x64 with Bun 1.3.14 and the repository's AI SDK 7 adapter, these deterministic cases produced:

| Payload | Model delta shape | Duration | Sampled peak RSS delta |
|---|---|---:|---:|
| 256 KiB | 256 deltas of 1 KiB | about 57 ms | about 25 MiB |
| 128 KiB | 131,072 deltas of 1 byte | about 4,000 ms | about 219 MiB |

The smaller response was roughly 70 times slower and used roughly nine times more peak memory. Exact numbers vary by runtime and machine; the replayed bytes and boundaries do not.

This result survived a test-runner correction that stopped retaining every text-delta event. The matrix consumes text incrementally and retains only a byte count, so the pressure is in or below the provider/AI SDK streaming path rather than in the report collector.

## What an incremental update is

An OpenAI-compatible streaming response is an HTTP Server-Sent Events stream. A text update looks like:

```text
data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}
```

The provider stack must handle each update independently. Depending on the implementation, each update may trigger:

1. HTTP/SSE framing and decoding.
2. JSON parsing and validation.
3. AI SDK stream-part construction.
4. Adapter conversion into an `AgentModelEvent`.
5. Async iterator scheduling and consumer callbacks.
6. Intermediate string or object allocation.

For 128 KiB delivered one byte at a time, those steps run 131,072 times. The same amount of content delivered in 1 KiB updates needs only 128 updates. The experiment changes event count while keeping content small enough that raw payload size should not dominate.

This does **not** yet prove which layer allocates the memory or consumes the CPU. It localizes the issue to the real HTTP/SSE → AI SDK → `@cline/llms` adapter boundary and provides an exact input for profiling that boundary.

## V8 CPU profile

The exact replay was also run under Node 24.16.0 with V8's `--cpu-prof` profiler. Because this repository's source graph uses Bun-compatible extensionless imports and has an unavailable optional Ollama dependency, the profiling command used an ignored Node-targeted bundle with source maps and a link-only Ollama stub. The stub throws if invoked; the replay uses the real OpenAI-compatible provider, AI SDK, Zod schemas, and Cline adapter.

| Shape | Duration | Sampled peak RSS delta |
|---|---:|---:|
| 128 KiB, one-byte updates | 4,701 ms | 181.6 MiB |
| 128 KiB, 1 KiB updates | 101 ms | 17.1 MiB |

The one-byte profile attributes 90.4% of sampled self CPU to V8/Node runtime work. The dominant frame is Node's WHATWG Web Streams queue:

| Function | Self time | Self CPU |
|---|---:|---:|
| `node:internal/webstreams/util:dequeueValue` | 5,375 ms | 46.4% |
| `runMicrotasks` | 572 ms | 4.9% |
| `pullAlgorithm` | 297 ms | 2.6% |
| Garbage collector | 271 ms | 2.3% |
| `readableStreamDefaultControllerCallPullIfNeeded` | 195 ms | 1.7% |
| `writableStreamUpdateBackpressure` | 187 ms | 1.6% |
| `transformStreamSetBackpressure` | 177 ms | 1.5% |
| `writableStreamDefaultControllerWrite` | 151 ms | 1.3% |
| `transformStreamDefaultControllerPerformTransform` | 132 ms | 1.1% |
| `writableStreamDefaultWriterWrite` | 123 ms | 1.1% |

This is not one hot Cline loop. The bulk of the cost is per-update Web Streams queueing, backpressure bookkeeping, pulls, writes, and microtask scheduling. JSON/schema/adapter work is present, but secondary. Batching adjacent text updates before they traverse every stream transform is therefore a higher-leverage direction than micro-optimizing `emitAiSdkEvents` alone.

The `.cpuprofile` is intentionally generated under the ignored results directory rather than committed. To recreate it, build a Node-targeted profile artifact from `matrix.ts`, then run the replay with:

```text
node --cpu-prof --cpu-prof-interval=1000 <matrix-artifact> --model <replay-model>
```

Profile both the one-byte replay and the 1 KiB control: module startup dominates the short control, so interpreting only one profile overstates unrelated initialization work.

## IDE-host behavior

The one-byte replay was exercised through an isolated SDK-backed VS Code Extension Development Host. The workbench and Cline renderer remained responsive to DevTools round trips during the stream:

| Probe | p95 | Maximum |
|---|---:|---:|
| Workbench renderer | 16 ms | 33 ms |
| Cline webview | 43 ms | 75 ms |

However, model-stream throughput collapsed downstream of the harness:

- the provider-only replay completes in about 4 seconds;
- the IDE reached only 87,552 of 131,072 updates;
- the last progress arrived after 37,041 ms;
- the stream stopped at 66.8% and never emitted its finish event;
- the harness repeatedly paused on HTTP backpressure while its own RSS stayed around 73 MiB.

This is not the same failure shape as a synchronously frozen extension host: the renderers answered probes while the client stopped draining the model stream. It is closer to a live-lock or throughput-collapse boundary between provider events, session processing, persistence, and host/webview reporting.

The extension host later exited and Crashpad produced a dump. Do **not** attribute that exit to this replay yet: VS Code updated from 1.131.0 to 1.132.0 immediately afterward, and update/restart activity is a material confounder. The 37-second backpressure stall happened before the update and is valid; the later exit needs reproduction on a pinned, stable VS Code build.

For a clean IDE comparison, pin the same VS Code build, reuse the same isolated user-data directory after dismissing first-run UI, run the 1 KiB control first, restart at the model/session boundary, and then run the one-byte replay. Record extension-host, workbench renderer, and webview renderer process metrics separately.

## Quick reproduction

From the repository root, install the workspace dependencies as usual, then run:

```bash
npm --prefix evals run harness:matrix -- --profile ci
```

Look for the two `text` rows. The one-byte case has this replay model:

```text
harness/replay-eyJ2ZXJzaW9uIjoxLCJzY2VuYXJpbyI6InRleHQiLCJzZWVkIjoxMiwic2l6ZSI6MTMxMDcyLCJjaHVua0J5dGVzIjoxLCJkZWxheU1zIjowLCJyb3VuZHMiOjEsInBhcmFsbGVsIjoxfQ
```

Run only that case:

```bash
npm --prefix evals run harness:matrix -- --model harness/replay-eyJ2ZXJzaW9uIjoxLCJzY2VuYXJpbyI6InRleHQiLCJzZWVkIjoxMiwic2l6ZSI6MTMxMDcyLCJjaHVua0J5dGVzIjoxLCJkZWxheU1zIjowLCJyb3VuZHMiOjEsInBhcmFsbGVsIjoxfQ
```

The command prints duration and sampled peak RSS delta. It also prints the replay model again so output copied into an issue remains independently runnable.

## Save a comparable report

Use the same command on Windows, macOS, and Linux:

```bash
npm --prefix evals run harness:matrix -- \
  --profile ci \
  --output evals/harness-stress/results/matrix-ci.json
```

PowerShell accepts the command on one line:

```powershell
npm.cmd --prefix evals run harness:matrix -- --profile ci --output evals/harness-stress/results/matrix-ci.json
```

The JSON records:

- OS and architecture;
- Bun version;
- canonical scenario spec and replay model;
- duration;
- reconstructed text bytes or tool-call count;
- sampled peak heap/RSS delta;
- end memory delta while parsed results remain live;
- pressure alerts and an exact replay command.

Generated reports under `evals/harness-stress/results/` are ignored by Git.

## Cross-platform comparison

For each platform:

1. Check out the same commit.
2. Use the repository's pinned Bun major and record the exact version printed in the report.
3. Close unrelated high-memory development processes where practical.
4. Run the CI profile three times.
5. Compare medians rather than selecting the fastest run.
6. Attach all JSON reports; do not transcribe only the headline numbers.

Suggested filenames:

```text
matrix-ci-windows-x64-1.json
matrix-ci-macos-arm64-1.json
matrix-ci-linux-x64-1.json
```

Useful questions:

- Does duration scale linearly with delta count on every platform?
- Does peak RSS scale similarly in Node-backed VS Code extension hosts and Bun?
- Is the amplification specific to the OpenAI-compatible provider package?
- Does changing only the AI SDK version move the threshold?
- Does a real IDE renderer add another multiplier after the provider emits events?

## Threshold sweep

The replay token is a canonical JSON spec encoded as base64url. For a broader sweep, edit the `ci` or `large` profile in `src/scenario-spec.mjs`, or construct specs with these axes:

```json
{
  "version": 1,
  "scenario": "text",
  "seed": 12,
  "size": 131072,
  "chunkBytes": 1,
  "delayMs": 0,
  "rounds": 1,
  "parallel": 1
}
```

Keep `size` fixed and vary `chunkBytes` through powers of two:

```text
1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096
```

Plot duration and peak RSS against `ceil(size / chunkBytes)`. A knee in that curve gives a concrete regression budget and helps distinguish per-event overhead from content-size overhead.

## Profiling directions

Start at the real adapter entry point rather than replacing it with a mock parser:

```text
evals/harness-stress/src/matrix.ts
  → createOpenAICompatibleProvider
  → sdk/packages/llms/src/providers/ai-sdk.ts
  → AI SDK streamText / provider stream parsing
  → AgentModelEvent async iterator
```

Useful experiments:

1. Sample CPU while replaying only the one-byte model.
2. Record allocation profiles for one-byte and 1 KiB cases.
3. Count objects by event type rather than only heap bytes.
4. Compare the raw `@ai-sdk/openai-compatible` stream with Cline's adapter enabled and bypassed.
5. Batch adjacent text deltas at one boundary at a time and compare the same replay.
6. Test whether UI updates are coalesced independently from model-event delivery.

Candidate improvements should preserve cancellation and first-token responsiveness. Possible approaches include:

- coalescing adjacent text deltas before expensive validation or host reporting;
- separating low-cost content accumulation from lower-frequency UI/state notifications;
- applying byte/time batching with a forced flush at tool, finish, error, and cancellation boundaries;
- avoiding repeated copies of the full accumulated response.

Do not optimize by dropping updates or delaying tool-call boundaries. The replay suite should verify byte-for-byte reconstructed output before evaluating performance.

## Pressure budgets

Protocol correctness and pressure thresholds are separate. To make the current finding fail automation:

```bash
npm --prefix evals run harness:matrix -- --profile ci --fail-on-alert
```

Default alerts are 2 seconds or 256 MiB sampled peak RSS delta. Override them explicitly when establishing platform baselines:

```bash
npm --prefix evals run harness:matrix -- \
  --profile ci \
  --max-duration-ms 1000 \
  --max-peak-rss-mib 192 \
  --fail-on-alert
```

An alert prints the exact replay command. This is the bridge from proactive discovery to a reproducible bug report.
