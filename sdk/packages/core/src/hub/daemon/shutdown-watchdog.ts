/**
 * Kept below HUB_RETIRE_TIMEOUT_MS (3s): a retiring caller waits that long for
 * this daemon to die after SIGTERM before escalating to SIGKILL, and a daemon
 * that always beats the wait keeps routine retirement escalation-free.
 */
export const HUB_DAEMON_SHUTDOWN_DEADLINE_MS = 2_000;

export interface HubDaemonShutdownWatchdogOptions {
	deadlineMs: number;
	exitCode: number;
	/** Written to stderr-backed daemon log before the forced exit. */
	onTimeout?: () => void;
	/** Injectable for tests; defaults to process.exit. */
	exit?: (code: number) => void;
}

/**
 * Forces the daemon down if graceful shutdown stalls.
 *
 * Shutdown awaits server.close(), and under Bun's node:http a server that has
 * accepted a WebSocket upgrade never delivers its close callback, even after
 * every socket is terminated (verified against Bun 1.3.13: terminate() and
 * wss.close() complete, server.close() never resolves). A hub with connectors
 * attached always has such a socket, and installing a SIGTERM handler disables
 * the runtime's default exit — so without a deadline, every retirement of a
 * Bun-runtime daemon leaves the process alive forever. The watchdog makes exit
 * unconditional: however close() behaves, the daemon is gone by the deadline.
 *
 * The timer is unref'd so it never extends the process's life; while shutdown
 * is stalled the server's own handles keep the loop (and the timer) running.
 */
export function armHubDaemonShutdownWatchdog(
	options: HubDaemonShutdownWatchdogOptions,
): void {
	const exit = options.exit ?? process.exit;
	const timer = setTimeout(() => {
		options.onTimeout?.();
		exit(options.exitCode);
	}, options.deadlineMs);
	timer.unref?.();
}
