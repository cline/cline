import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	rename,
	rm,
	rmdir,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export const TOOL_RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const activeDirectories = new Map<string, number>();

function sessionDirectory(root: string, sessionId: string): string {
	if (!sessionId)
		throw new Error("A session ID is required for tool result caching");
	const encoded = encodeURIComponent(sessionId).replace(/\./g, "%2E");
	const key =
		encoded.length <= 160
			? encoded
			: `@${createHash("sha256").update(sessionId).digest("hex")}`;
	return join(root, key);
}

export function toolResultCacheRoot(): string {
	return join(resolveClineDataDir(), "cache", "sessions");
}

/** Expiry is based on last use. Live runtimes hold a lease on their session directory. */
export async function pruneToolResultCache(
	root = toolResultCacheRoot(),
	now = Date.now(),
): Promise<void> {
	let sessions: Dirent[];
	try {
		sessions = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	for (const session of sessions) {
		if (!session.isDirectory()) continue;
		const directory = join(root, session.name);
		if (activeDirectories.has(directory)) continue;
		try {
			for (const file of await readdir(directory, { withFileTypes: true })) {
				if (activeDirectories.has(directory)) break;
				if (!file.isFile() || !/\.(result\.txt|tmp)$/.test(file.name)) continue;
				const path = join(directory, file.name);
				if (now - (await stat(path)).mtimeMs > TOOL_RESULT_CACHE_TTL_MS)
					await rm(path, { force: true });
			}
			// Nonempty directories and concurrent deletions are harmless.
			await rmdir(directory);
		} catch {
			/* Cache maintenance must not interrupt a session. */
		}
	}
}

export async function deleteToolResultCache(
	sessionId: string,
	root = toolResultCacheRoot(),
): Promise<void> {
	await rm(sessionDirectory(root, sessionId), { recursive: true, force: true });
}

/** Disposable recovery cache. It owns no transcript, save records, or resume state. */
export function createToolResultCache(
	sessionId: string,
	options: {
		root?: string;
		onError?: (error: unknown) => void;
	} = {},
) {
	const root = resolve(options.root ?? toolResultCacheRoot());
	const directory = sessionDirectory(root, sessionId);
	activeDirectories.set(directory, (activeDirectories.get(directory) ?? 0) + 1);
	const cleanup = () => {
		void pruneToolResultCache(root).catch(options.onError ?? (() => {}));
	};
	cleanup();
	const timer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
	timer.unref();
	const pending = new Map<string, Promise<string>>();
	let closed = false;
	return {
		async save(toolCallId: string, text: string): Promise<string> {
			if (closed) throw new Error("Tool result cache is closed");
			const id = createHash("sha256")
				.update(`${toolCallId.length}:`)
				.update(toolCallId)
				.update(text)
				.digest("hex");
			const path = join(directory, `${id}.result.txt`);
			const existing = pending.get(path);
			if (existing) return existing;
			const write = (async () => {
				try {
					if ((await stat(path)).isFile()) {
						const now = new Date();
						await utimes(path, now, now);
						return path;
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				await mkdir(directory, { recursive: true, mode: 0o700 });
				const temporary = join(directory, `${randomUUID()}.tmp`);
				try {
					await writeFile(temporary, text, {
						encoding: "utf8",
						mode: 0o600,
						flag: "wx",
					});
					await rename(temporary, path);
					return path;
				} finally {
					await rm(temporary, { force: true });
				}
			})();
			pending.set(path, write);
			try {
				return await write;
			} finally {
				pending.delete(path);
			}
		},
		close() {
			if (closed) return;
			closed = true;
			clearInterval(timer);
			const count = activeDirectories.get(directory) ?? 1;
			if (count === 1) activeDirectories.delete(directory);
			else activeDirectories.set(directory, count - 1);
		},
	};
}
