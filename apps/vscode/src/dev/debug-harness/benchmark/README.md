# Real-host Scroll Benchmark (V14)

Automated performance gate for the Cline webview running inside a real VS Code
extension host. Complements the headless vitest/bun suites with real
Electron/Chromium frame-rate, jank and memory data.

## Components

| File | Purpose |
|------|---------|
| `benchmark-metrics.ts` | Pure FPS/jank/memory statistics (unit-tested) |
| `benchmark-metrics.test.ts` | Unit tests for the metrics |
| `run-scroll-benchmark.ts` | Harness client: drives the debug-harness server |

## Run

1. Start the debug harness (see `apps/vscode/src/dev/debug-harness/README.md`):

   ```bash
   node src/dev/debug-harness/server.ts --auto-launch --skip-build
   ```

2. Run the benchmark:

   ```bash
   bun run src/dev/debug-harness/benchmark/run-scroll-benchmark.ts --messages 100 --duration 3000
   ```

   Flags: `--messages` (synthetic rows, default 100), `--duration` (sampling ms,
   default 3000), `--port` (harness port, default 19229), `--budget-mb`
   (default 200), `--min-p95-fps` (default 30), `--max-jank-rate` (default 0.1).

## Pass criteria (V14 targets)

- p95 FPS ≥ 30 while ping-pong scrolling 100+ synthetic message rows
- Jank rate (frames > 50ms) ≤ 10%
- Peak JS heap ≤ 200MB

Exit code `0` = pass, `1` = fail. The JSON report is printed to stdout for CI
capture.

## Notes

- The injected rows are lightweight synthetic DOM; they stress scrolling,
  layout and virtualization churn rather than real markdown rendering. For
  message-content stress, drive `ui.send_message` with real text instead.
- Run from a process that is NOT itself spawned by VS Code (see
  `.clinerules/debug-harness.md` — inherited `ELECTRON_RUN_AS_NODE` breaks the
  child launch).
