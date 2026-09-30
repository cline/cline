import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Cross-process mutex for short read-modify-write sections on shared files.
 *
 * The lock is a directory (`mkdir` is atomic on every supported filesystem)
 * holding an `owner.json` record. Locks whose owner process is gone, or that
 * are older than `maxAgeMs`, are reclaimed. The lock is not reentrant: callers
 * must serialize same-process work before acquiring it.
 */
export interface FileMutationLockOptions {
	/** Human-readable name used in timeout errors. */
	label: string;
	/** How long to wait for a live holder before failing. */
	waitMs?: number;
	/** Age after which a held lock is treated as abandoned. */
	maxAgeMs?: number;
	pollMs?: number;
}

const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_MAX_AGE_MS = 30_000;
const DEFAULT_POLL_MS = 100;

export function resolveFileMutationLockDir(lockBasis: string): string {
	return `${lockBasis}.lock`;
}

function isPidAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error
			? String((error as NodeJS.ErrnoException).code) === "EPERM"
			: false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLockRecord(
	lockDir: string,
): Promise<{ pid: number; acquiredAt: string } | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(join(lockDir, "owner.json"), "utf8"),
		) as Partial<{ pid: number; acquiredAt: string }>;
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return undefined;
		}
		return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
	} catch {
		return undefined;
	}
}

async function removeLock(lockDir: string): Promise<void> {
	await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function withFileMutationLock<T>(
	lockBasis: string,
	options: FileMutationLockOptions,
	callback: () => Promise<T>,
): Promise<T> {
	const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const lockDir = resolveFileMutationLockDir(lockBasis);
	await mkdir(dirname(lockDir), { recursive: true });
	const deadline = Date.now() + waitMs;

	while (true) {
		try {
			await mkdir(lockDir, { recursive: false });
		} catch (error) {
			const code =
				error instanceof Error && "code" in error
					? String((error as NodeJS.ErrnoException).code)
					: "";
			if (code !== "EEXIST") {
				throw error;
			}
			const record = await readLockRecord(lockDir);
			if (!record) {
				// The winner creates the directory before it can publish owner.json.
				// Do not steal that initialization window. A genuinely abandoned
				// empty lock is reclaimed only after the bounded wait.
				if (Date.now() >= deadline) {
					await removeLock(lockDir);
					continue;
				}
				await sleep(pollMs);
				continue;
			}
			const lockAge = Date.now() - Date.parse(record.acquiredAt);
			if (!isPidAlive(record.pid) || lockAge > maxAgeMs) {
				await removeLock(lockDir);
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(
					`Timed out waiting for ${options.label} lock ${lockDir}`,
				);
			}
			await sleep(pollMs);
			continue;
		}

		try {
			await writeFile(
				join(lockDir, "owner.json"),
				`${JSON.stringify(
					{ pid: process.pid, acquiredAt: new Date().toISOString() },
					null,
					2,
				)}\n`,
				"utf8",
			);
			return await callback();
		} finally {
			await removeLock(lockDir);
		}
	}
}
