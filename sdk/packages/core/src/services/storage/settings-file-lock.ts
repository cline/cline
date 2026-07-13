import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	renameSync,
	rmdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { sdkDebug } from "../../logging/early-logger";

/**
 * Cross-process lock serializing OAuth token rotation against a settings file
 * (providers.json). Same populated-directory algorithm as the MCP settings
 * lock (extensions/mcp/config-loader.ts): acquisition stages a directory with
 * a unique owner marker and renames it into place, release removes only our
 * marker, stale takeover renames the directory aside. Portable mkdir/rename/
 * rmdir only — works on Windows and POSIX.
 *
 * Differences from the MCP lock, both deliberate:
 * - The lock is held ACROSS the refresh network call. Refresh tokens are
 *   single-use upstream, so two processes must never rotate concurrently;
 *   serializing only the file write would not prevent that. staleMs must
 *   therefore stay greater than the refresh HTTP timeout (30s) so a healthy
 *   in-flight holder is never reclaimed.
 * - Contention degrades instead of throwing: same-process callers queue on a
 *   promise chain, cross-process waiters poll, and an acquisition timeout
 *   falls through to running the body WITHOUT the lock. Failing the user's
 *   request over lock trouble would be worse than an unserialized refresh —
 *   the adopt-disk recovery in the refresh helper is the safety net for that
 *   path.
 */

const OAUTH_LOCK_STALE_MS = 60_000;
const OAUTH_LOCK_POLL_MS = 25;
const OAUTH_LOCK_TIMEOUT_MS = 45_000;

// The mutation lock guards only an in-memory read-modify-write plus one file
// write (milliseconds), so its thresholds are far tighter than the refresh
// lock's.
const MUTATION_LOCK_STALE_MS = 2_000;
const MUTATION_LOCK_POLL_MS = 5;
const MUTATION_LOCK_TIMEOUT_MS = 3_000;

type LockOptions = {
	staleMs?: number;
	pollMs?: number;
	timeoutMs?: number;
};

interface AcquiredLock {
	lockDir: string;
	ownerFile: string;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
	Atomics.wait(syncSleepBuffer, 0, 0, ms);
}

function makeLockToken(): string {
	return `${process.pid}.${Date.now()}.${randomUUID()}`;
}

function tryAcquireLock(
	lockDir: string,
	token: string,
): AcquiredLock | undefined {
	mkdirSync(dirname(lockDir), { recursive: true });
	const stagingDir = `${lockDir}.tmp.${token}`;
	rmSync(stagingDir, { recursive: true, force: true });
	mkdirSync(stagingDir, { recursive: true });
	writeFileSync(join(stagingDir, `owner.${token}`), token, {
		encoding: "utf8",
		flag: "wx",
	});
	try {
		renameSync(stagingDir, lockDir);
		return { lockDir, ownerFile: join(lockDir, `owner.${token}`) };
	} catch (error) {
		rmSync(stagingDir, { recursive: true, force: true });
		if (existsSync(lockDir)) {
			return undefined;
		}
		throw error;
	}
}

function reclaimStaleLock(lockDir: string, staleMs: number): void {
	let ageMs: number;
	try {
		ageMs = Date.now() - statSync(lockDir).mtimeMs;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
	if (ageMs < staleMs) {
		return;
	}
	sdkDebug(`oauth.lock stale lock at ${lockDir} (age ${ageMs}ms); reclaiming`);
	const staleDir = `${lockDir}.stale.${makeLockToken()}`;
	try {
		renameSync(lockDir, staleDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
	rmSync(staleDir, { recursive: true, force: true });
}

function releaseLock(lock: AcquiredLock): void {
	try {
		unlinkSync(lock.ownerFile);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
	try {
		rmdirSync(lock.lockDir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error;
		}
	}
}

// Same-process refresh attempts queue here instead of spinning on the
// directory (the extension runs two independent refreshers: AuthService and
// the embedded RuntimeOAuthTokenManager).
const inProcessQueues = new Map<string, Promise<unknown>>();

export async function withSettingsRefreshLock<T>(
	settingsFilePath: string,
	fn: () => Promise<T>,
	options?: LockOptions,
): Promise<T> {
	const lockDir = `${settingsFilePath}.oauth.lock`;
	const staleMs = options?.staleMs ?? OAUTH_LOCK_STALE_MS;
	const pollMs = options?.pollMs ?? OAUTH_LOCK_POLL_MS;
	const timeoutMs = options?.timeoutMs ?? OAUTH_LOCK_TIMEOUT_MS;

	const run = async (): Promise<T> => {
		const token = makeLockToken();
		const startedAt = Date.now();
		let lock: AcquiredLock | undefined;
		while (!lock) {
			lock = tryAcquireLock(lockDir, token);
			if (lock) {
				break;
			}
			if (Date.now() - startedAt > timeoutMs) {
				sdkDebug(
					`oauth.lock timed out waiting for ${lockDir} after ${timeoutMs}ms; proceeding without lock`,
				);
				break;
			}
			reclaimStaleLock(lockDir, staleMs);
			await delay(pollMs);
		}
		try {
			return await fn();
		} finally {
			if (lock) {
				releaseLock(lock);
			}
		}
	};

	const previous = inProcessQueues.get(lockDir) ?? Promise.resolve();
	const chained = previous.then(run, run);
	const tracked = chained.catch(() => {});
	inProcessQueues.set(lockDir, tracked);
	void tracked.finally(() => {
		if (inProcessQueues.get(lockDir) === tracked) {
			inProcessQueues.delete(lockDir);
		}
	});
	return chained;
}

/**
 * Serialize a synchronous read-modify-write of the settings file across
 * processes. Without this, ANY settings save racing a token rotation can
 * write back a merge built from a stale read — reverting the freshly rotated
 * (single-use!) refresh token on disk, which the next refresher then burns.
 *
 * Uses a `.write.lock` directory distinct from the refresh lock: mutators
 * must never wait on a lock held across a 30s network call, and the refresh
 * helper's own save takes this lock nested inside its refresh lock (different
 * directories, ordered acquisition, no deadlock). Contention degrades to
 * running unlocked after `timeoutMs` — same rationale as the refresh lock.
 */
export function withSettingsMutationLockSync<T>(
	settingsFilePath: string,
	fn: () => T,
	options?: LockOptions,
): T {
	const lockDir = `${settingsFilePath}.write.lock`;
	const staleMs = options?.staleMs ?? MUTATION_LOCK_STALE_MS;
	const pollMs = options?.pollMs ?? MUTATION_LOCK_POLL_MS;
	const timeoutMs = options?.timeoutMs ?? MUTATION_LOCK_TIMEOUT_MS;

	const token = makeLockToken();
	const startedAt = Date.now();
	let lock: AcquiredLock | undefined;
	while (!lock) {
		lock = tryAcquireLock(lockDir, token);
		if (lock) {
			break;
		}
		if (Date.now() - startedAt > timeoutMs) {
			sdkDebug(
				`settings.write.lock timed out waiting for ${lockDir} after ${timeoutMs}ms; proceeding without lock`,
			);
			break;
		}
		reclaimStaleLock(lockDir, staleMs);
		sleepSync(pollMs);
	}
	try {
		return fn();
	} finally {
		if (lock) {
			releaseLock(lock);
		}
	}
}
