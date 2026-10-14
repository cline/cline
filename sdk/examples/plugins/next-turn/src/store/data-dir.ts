import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import { PLUGIN_NAME } from "../config";

/** Owner read/write only: settings and caches can name repositories and accounts. */
export const PRIVATE_FILE_MODE = 0o600;

type NextTurnPaths = {
	root: string;
	settings: string;
	cursor: string;
	labels: string;
	sessions: string;
	plannerLedger: string;
};

/** Where Next Turn keeps its state, beside other plugins' under Cline's data dir. Nothing is created until written. */
export function nextTurnPaths(
	dataDir: string = resolveClineDataDir(),
): NextTurnPaths {
	const root = join(dataDir, "plugins", PLUGIN_NAME);
	return {
		root,
		settings: join(root, "settings.json"),
		cursor: join(root, "cursor.json"),
		labels: join(root, "labels.jsonl"),
		sessions: join(root, "sessions"),
		plannerLedger: join(root, "planner.jsonl"),
	};
}

function fileVersion(path: string): string {
	try {
		const stat = statSync(path, { throwIfNoEntry: false });
		return stat ? `${stat.mtimeMs}:${stat.size}` : "absent";
	} catch {
		return "unreadable";
	}
}

/**
 * `read`'s value, read again only when the file at `path` changes (its mtime
 * or size), so a change another process makes applies to the next call.
 * `read` gets the value it last returned.
 */
export function cachedByFile<T>(
	path: string,
	read: (previous: T | undefined) => T,
): () => T {
	let cached: { version: string; value: T } | undefined;
	return () => {
		const version = fileVersion(path);
		if (cached?.version !== version)
			cached = { version, value: read(cached?.value) };
		return cached.value;
	};
}

/**
 * Run a write into `path`'s directory, creating the directory only when the
 * write finds it missing: the person may remove the data dir while a chat runs.
 */
function inParentDirectory(path: string, write: () => void): void {
	try {
		write();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		mkdirSync(dirname(path), { recursive: true });
		write();
	}
}

/**
 * Write a file so a reader never sees half of it: write a sibling, then
 * rename over the target. The desktop and the CLI read the same settings file.
 */
export function writeFileAtomic(path: string, contents: string): void {
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		inParentDirectory(path, () =>
			writeFileSync(temp, contents, { mode: PRIVATE_FILE_MODE }),
		);
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

/** Append one record as a JSON line, owner-only like every file here. */
export function appendJsonLine(path: string, record: unknown): void {
	const line = `${JSON.stringify(record)}\n`;
	inParentDirectory(path, () =>
		appendFileSync(path, line, { mode: PRIVATE_FILE_MODE }),
	);
}

/** The JSON at `path`, or undefined when it is missing or does not parse. */
export function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
