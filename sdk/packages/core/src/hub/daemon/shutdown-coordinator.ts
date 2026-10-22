/**
 * Kept below the caller-side retirement wait so a current daemon exits through
 * its own cleanup deadline before an older caller considers force retirement.
 */
export const HUB_DAEMON_SHUTDOWN_DEADLINE_MS = 2_000;

export interface HubDaemonShutdownRequest {
	reason: string;
	exitCode: number;
}

export type HubDaemonShutdownState =
	| "idle"
	| "shutting_down"
	| "forced"
	| "finished";

export interface HubDaemonShutdownCoordinatorOptions {
	deadlineMs: number;
	cleanup(): Promise<void>;
	exit(code: number): void;
	onCleanupError?(error: unknown): void;
	onForcedExit?(request: HubDaemonShutdownRequest): void;
}

export interface HubDaemonShutdownCoordinator {
	request(request: HubDaemonShutdownRequest): Promise<void>;
	force(request: HubDaemonShutdownRequest): void;
	getState(): HubDaemonShutdownState;
}

/**
 * Owns the daemon's monotonic shutdown lifecycle.
 *
 * Every graceful trigger shares one cleanup promise. A later fatal trigger can
 * raise the eventual exit code, but it cannot run cleanup twice. The deadline
 * and an explicit second-signal path both use `force`, whose exit is also
 * guarded so an injected test exit that returns cannot be called repeatedly.
 */
export function createHubDaemonShutdownCoordinator(
	options: HubDaemonShutdownCoordinatorOptions,
): HubDaemonShutdownCoordinator {
	let state: HubDaemonShutdownState = "idle";
	let requestedExitCode = 0;
	let shutdownPromise: Promise<void> | undefined;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let exitRequested = false;

	const requestExit = (code: number): void => {
		if (exitRequested) {
			return;
		}
		exitRequested = true;
		options.exit(code);
	};

	const force = (request: HubDaemonShutdownRequest): void => {
		requestedExitCode = Math.max(requestedExitCode, request.exitCode);
		if (state === "forced" || state === "finished") {
			return;
		}
		state = "forced";
		if (watchdog) {
			clearTimeout(watchdog);
			watchdog = undefined;
		}
		try {
			options.onForcedExit?.({
				...request,
				exitCode: requestedExitCode,
			});
		} finally {
			// Logging/telemetry hooks are best-effort. A hook failure must never
			// disarm the watchdog and strand the daemon in the forced state.
			requestExit(requestedExitCode);
		}
	};

	const request = (
		shutdownRequest: HubDaemonShutdownRequest,
	): Promise<void> => {
		requestedExitCode = Math.max(requestedExitCode, shutdownRequest.exitCode);
		if (shutdownPromise) {
			return shutdownPromise;
		}

		state = "shutting_down";
		watchdog = setTimeout(() => {
			force({
				reason: `shutdown deadline exceeded after ${shutdownRequest.reason}`,
				exitCode: requestedExitCode,
			});
		}, options.deadlineMs);
		// Keep the watchdog referenced. If every other handle disappears while a
		// fatal cleanup promise is still pending, natural process exit could report
		// code 0 instead of the requested failure code.

		shutdownPromise = (async () => {
			try {
				// Defer invocation one microtask so `shutdownPromise` is assigned
				// before cleanup can synchronously re-enter `request()`.
				await Promise.resolve().then(() => options.cleanup());
			} catch (error) {
				requestedExitCode = Math.max(requestedExitCode, 1);
				options.onCleanupError?.(error);
			} finally {
				if (watchdog) {
					clearTimeout(watchdog);
					watchdog = undefined;
				}
				if (state === "shutting_down") {
					state = "finished";
					requestExit(requestedExitCode);
				}
			}
		})();
		return shutdownPromise;
	};

	return {
		request,
		force,
		getState: () => state,
	};
}
