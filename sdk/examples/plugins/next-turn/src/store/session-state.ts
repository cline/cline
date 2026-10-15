import { randomUUID } from "node:crypto";
import {
	existsSync,
	linkSync,
	renameSync,
	rmSync,
	type Stats,
	statSync,
} from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_STATE_TTL_MS } from "../config";
import type { TurnSnapshot } from "../planner/next";
import type { TrayPush } from "../planner/tray";
import type { Turn } from "../planner/turn";
import { isRecord } from "../values";
import { readJsonFile, sha256Hex, writeFileAtomic } from "./data-dir";

const SESSION_STATE_VERSION = 1;

type PersistedSessionState = {
	v: typeof SESSION_STATE_VERSION;
	sessionId: string;
	updatedAt: number;
	viewerClient?: string;
	hiddenForChat?: boolean;
	seq: number;
	lastPush?: TrayPush;
	lastTurn?: Turn;
	lastChat?: Turn["chat"];
	turnState?: TurnSnapshot;
};

type SessionStateFields = Omit<
	PersistedSessionState,
	"v" | "sessionId" | "updatedAt"
>;

export interface SessionStateStore {
	read(): PersistedSessionState | undefined;
	write(state: SessionStateFields): void;
}

/** Writes `patch` over what is stored, keeping every field it does not name; an explicit undefined clears one. */
export function updateSessionState(
	store: SessionStateStore,
	patch: Partial<SessionStateFields>,
): void {
	const {
		v: _version,
		sessionId: _sessionId,
		updatedAt: _updatedAt,
		...stored
	} = store.read() ?? {
		v: SESSION_STATE_VERSION,
		sessionId: "",
		updatedAt: 0,
		seq: 0,
	};
	store.write({ ...stored, ...patch });
}

/**
 * One chat's tray state in `<data>/plugins/next-turn/sessions/<hash>.json`, so
 * a respawn after a sandbox idle reclaim keeps the set on screen, the turn's
 * offers, manifest, pool and exclusions, the sequence, and the viewer mark.
 */
export class FileSessionStateStore implements SessionStateStore {
	private readonly filePath: string;
	/**
	 * What this store last read or wrote (`null`: nothing), as the file holds
	 * it: a copy, never the caller's live objects. This chat's worker is the
	 * file's only writer, so the file is read once.
	 */
	private cached: PersistedSessionState | null | undefined;

	constructor(
		dir: string,
		private readonly sessionId: string,
		private readonly now: () => number = Date.now,
	) {
		this.filePath = join(dir, `${sha256Hex(sessionId)}.json`);
	}

	read(): PersistedSessionState | undefined {
		if (this.cached === undefined) this.cached = this.readFile() ?? null;
		const record = this.cached;
		if (!record) return undefined;
		if (
			typeof record.updatedAt === "number" &&
			this.now() - record.updatedAt > SESSION_STATE_TTL_MS
		) {
			this.clear();
			return undefined;
		}
		return record;
	}

	write(state: SessionStateFields): void {
		const record: PersistedSessionState = {
			...state,
			v: SESSION_STATE_VERSION,
			sessionId: this.sessionId,
			updatedAt: this.now(),
		};
		const text = JSON.stringify(record);
		this.cached = JSON.parse(text) as PersistedSessionState;
		try {
			writeFileAtomic(this.filePath, `${text}\n`);
		} catch {}
	}

	private clear(): void {
		this.cached = null;
		try {
			rmSync(this.filePath, { force: true });
		} catch {}
	}

	private readFile(): PersistedSessionState | undefined {
		const parsed = readJsonFile(this.filePath) as
			| Partial<PersistedSessionState>
			| null
			| undefined;
		return parsed?.v === SESSION_STATE_VERSION &&
			parsed.sessionId === this.sessionId
			? (parsed as PersistedSessionState)
			: undefined;
	}
}

/**
 * Deletes `path` only while it is still the version `checked` saw. Another
 * chat's worker can rename fresh state onto the path at any moment, so the
 * file is first renamed aside, which no write can interleave with. A version
 * written since the check goes back with `link`, which never overwrites a
 * write that landed after the rename. The aside name ends in `.tmp`, so a
 * prune cut short leaves only what a later prune removes.
 */
function removeIfUnchanged(path: string, checked: Stats): void {
	const aside = `${path}.${process.pid}.${randomUUID()}.tmp`;
	renameSync(path, aside);
	const moved = statSync(aside);
	if (
		moved.ino === checked.ino &&
		moved.mtimeMs === checked.mtimeMs &&
		moved.size === checked.size
	) {
		rmSync(aside, { force: true });
		return;
	}
	try {
		linkSync(aside, path);
	} catch (error) {
		const newerWrite = isRecord(error) && error.code === "EEXIST";
		if (!newerWrite && !existsSync(path)) {
			renameSync(aside, path);
			return;
		}
	}
	rmSync(aside, { force: true });
}

/**
 * Removes every chat's state file, and any temporary file a worker left
 * mid-write, last written longer than the TTL ago. A chat's own store also
 * expires its file on read, so this only keeps the directory from growing.
 */
export async function pruneSessionStates(
	dir: string,
	now: number = Date.now(),
): Promise<void> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return;
	}
	const expired = (mtimeMs: number) => now - mtimeMs > SESSION_STATE_TTL_MS;
	await Promise.all(
		names
			.filter((name) => name.endsWith(".json") || name.endsWith(".tmp"))
			.map(async (name) => {
				const path = join(dir, name);
				try {
					const checked = await stat(path);
					if (expired(checked.mtimeMs)) removeIfUnchanged(path, checked);
				} catch {}
			}),
	);
}
