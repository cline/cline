# Fix: Refactor terminal completion detection to resolve intermittent "stuck/pending" states

## The Problem
Cline currently relies on a fragile, unbounded `for await` loop over `execution.read()` to detect terminal command completion. The loop only terminates if the stream naturally closes or if a specific `]633;D` OSC marker is parsed from the output stream.

However, VS Code's `shellIntegration` is known to be unreliable across different shells, custom prompts, and heavily loaded environments. Completion markers can be dropped, delayed, or misordered. When this happens, `VscodeTerminalProcess.run()` hangs indefinitely, causing the Cline UI to remain permanently stuck in a "pending" or "spinner" state, even though the command has successfully finished executing in the terminal.

## The Solution
This PR shifts the completion detection architecture from a fragile stream-parsing-centric approach to a robust, event-driven, multi-layered fallback strategy:

1.  **Primary Signal:** We now listen to the high-level `vscode.window.onDidEndTerminalShellExecution` event. This is the most reliable, officially supported way to know when VS Code considers a shell execution complete.
2.  **Secondary Signal:** We maintain the legacy parsing of the `]633;D` marker from the output stream as a backup for older VS Code versions or edge cases.
3.  **Tertiary Signal:** Natural stream closure (`result.done` from the async iterator).
4.  **Quaternary Guardrail:** A 30-second **idle timeout** wrapper around the `Promise.race` loop. If the terminal goes completely silent (no output, no markers, no events) for 30 seconds, the loop safely breaks, assuming the command has finished but failed to signal. It then triggers the existing `terminal snapshot fallback` mechanism to capture any final output, ensuring the agent is never permanently blocked.

## Expected Impact
This fix is expected to resolve or substantially mitigate Cline terminal-pending issues including **#5990**, **#8824**, **#7906**, **#7985**, **#8448**, **#4737**, **#6333**, **#7080**, **#7110**, and likely **#2314**.

## Testing & Reproducibility
A new comprehensive test suite (`TerminalStateMatrix.test.ts`) has been added to rigorously verify this new state machine. The tests isolate and prove the reliability of each fallback level:
-   Verified completion via API event simulation.
-   Verified fallback to OSC marker parsing when the API event is missing.
-   Verified graceful completion upon stream closure.
-   Verified that the 30-second idle timeout successfully unblocks a completely dead stream and triggers the snapshot fallback.
-   Verified that `continue()` safely removes listeners and prevents stale state updates during cancellation.