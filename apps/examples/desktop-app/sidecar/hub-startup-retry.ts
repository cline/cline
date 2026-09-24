/**
 * Keeps the sidecar alive while the Hub it depends on is still coming up.
 *
 * Before this, a Hub that was not ready in time made `initializeSessionManager`
 * throw, the sidecar exited, and the Tauri shell respawned a fresh process
 * that started the same cold Hub from scratch with a fresh clock. A Hub that
 * needed 20s never got 20s. Retrying inside one process lets the second
 * attempt attach to the daemon the first attempt already spawned.
 */

/**
 * How long the sidecar keeps retrying before giving up for real. Matches the
 * webview's `CONNECT_WAIT_TIMEOUT_MS` (webview/lib/desktop-client.ts): past
 * that the UI has already shown its error and offers a manual retry, which
 * re-requests the endpoint and gets a freshly respawned sidecar.
 */
export const HUB_STARTUP_RETRY_WINDOW_MS = 90_000;
export const HUB_STARTUP_RETRY_DELAY_MS = 1_000;

const HUB_UNAVAILABLE_PREFIX = "No compatible hub runtime is available";

/**
 * Only Hub-availability failures are worth waiting out. Anything else
 * (unreadable settings, a broken install) fails fast as before.
 */
export function isHubUnavailableError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.startsWith(HUB_UNAVAILABLE_PREFIX)
	);
}

export interface RetryUntilHubAvailableOptions {
	windowMs?: number;
	delayMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** Called before each wait, with the failure that caused it. */
	onRetry?: (details: {
		error: unknown;
		attempt: number;
		elapsedMs: number;
	}) => void;
}

export async function retryUntilHubAvailable<T>(
	attempt: () => Promise<T>,
	options: RetryUntilHubAvailableOptions = {},
): Promise<T> {
	const windowMs = options.windowMs ?? HUB_STARTUP_RETRY_WINDOW_MS;
	const delayMs = options.delayMs ?? HUB_STARTUP_RETRY_DELAY_MS;
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const startedAt = now();
	for (let attemptNumber = 1; ; attemptNumber += 1) {
		try {
			return await attempt();
		} catch (error) {
			const elapsedMs = now() - startedAt;
			if (!isHubUnavailableError(error) || elapsedMs + delayMs >= windowMs) {
				throw error;
			}
			options.onRetry?.({ error, attempt: attemptNumber, elapsedMs });
			await sleep(delayMs);
		}
	}
}
