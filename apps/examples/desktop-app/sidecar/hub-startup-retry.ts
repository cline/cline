export const HUB_STARTUP_RETRY_WINDOW_MS = 90_000;
export const HUB_STARTUP_RETRY_DELAY_MS = 1_000;

const HUB_UNAVAILABLE_PREFIX = "No compatible hub runtime is available";

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
