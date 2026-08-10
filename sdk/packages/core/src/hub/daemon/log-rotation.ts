import { copyFile, stat, truncate } from "node:fs/promises";

const HUB_LOG_MAX_BYTES = 25 * 1024 * 1024;
const HUB_LOG_CHECK_INTERVAL_MS = 60_000;

export function startHubLogRotation(
	logPath: string,
	options: { maxBytes?: number; intervalMs?: number } = {},
): () => void {
	const maxBytes = options.maxBytes ?? HUB_LOG_MAX_BYTES;
	const intervalMs = options.intervalMs ?? HUB_LOG_CHECK_INTERVAL_MS;
	let rotating = false;

	const rotateIfNeeded = async (): Promise<void> => {
		if (rotating) return;
		rotating = true;
		try {
			const logStat = await stat(logPath);
			if (logStat.size < maxBytes) return;
			await copyFile(logPath, `${logPath}.1`);
			await truncate(logPath, 0);
		} catch {
			// Logging must never prevent the hub from running.
		} finally {
			rotating = false;
		}
	};

	void rotateIfNeeded();
	const timer = setInterval(() => void rotateIfNeeded(), intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
