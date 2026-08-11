/**
 * Kept below the daemon retirement wait. A normal graceful shutdown should
 * finish first; if Bun leaves node:http's close callback pending after a
 * WebSocket upgrade, the daemon must still release its process promptly.
 */
export const HUB_DAEMON_SHUTDOWN_DEADLINE_MS = 2_000;

export interface HubDaemonShutdownWatchdogOptions {
	deadlineMs: number;
	exitCode: number;
	onTimeout?: () => void;
	exit?: (code: number) => void;
}

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
