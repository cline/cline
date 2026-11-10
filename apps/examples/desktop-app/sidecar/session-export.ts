import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
	findArtifactUnderDir,
	rootSessionIdFrom,
	sharedSessionDataDir,
	sharedSessionMessagesPath,
} from "./paths";

export type SessionHistoryExportResult = {
	/** The session history file that was copied. */
	sourcePath: string;
	/** Where the copy was written. */
	path: string;
	fileName: string;
};

function isExistingFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Locates the session history (messages) JSON file stored on disk for a local
 * session. `recordedPaths` are the locations the session row / manifest
 * recorded, which is the only way to find a child agent's transcript since it
 * is nested under its root session's directory.
 */
export function resolveSessionHistoryFilePath(
	sessionId: string,
	recordedPaths: ReadonlyArray<string | null | undefined> = [],
): string | null {
	const candidates = [sharedSessionMessagesPath(sessionId), ...recordedPaths];
	for (const candidate of candidates) {
		const path = typeof candidate === "string" ? candidate.trim() : "";
		if (path && isExistingFile(path)) {
			return path;
		}
	}
	return findArtifactUnderDir(
		join(sharedSessionDataDir(), rootSessionIdFrom(sessionId)),
		`${sessionId}.messages.json`,
		4,
	);
}

function isSameFile(a: string, b: string): boolean {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		// The destination usually does not exist yet.
		return false;
	}
}

/** Read complete JSON bytes that were unchanged for the duration of the read.
 * The Hub rewrites history in place, so a read can overlap a truncate/write.
 * Retry those reads before touching the destination, keeping the original bytes.
 */
async function readSessionHistorySnapshot(sourcePath: string): Promise<Buffer> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		if (attempt > 0) await setTimeout(25);
		const before = await stat(sourcePath, { bigint: true });
		const snapshot = await readFile(sourcePath);
		const after = await stat(sourcePath, { bigint: true });
		if (
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			before.size !== after.size ||
			after.size !== BigInt(snapshot.length) ||
			before.mtimeNs !== after.mtimeNs ||
			before.ctimeNs !== after.ctimeNs
		) {
			continue;
		}
		try {
			JSON.parse(snapshot.toString("utf8"));
		} catch (error) {
			if (error instanceof SyntaxError) continue;
			throw error;
		}
		return snapshot;
	}
	throw new Error(
		"Session history is being updated or contains incomplete JSON. Try exporting again.",
	);
}

/**
 * Copies a session's history file, unchanged, to the exact `destinationPath`
 * the user chose in the save dialog. An existing file there is replaced: the
 * save dialog has already asked the user to confirm that.
 */
export async function exportSessionHistoryFile(input: {
	sessionId: string;
	destinationPath: string;
	recordedPaths?: ReadonlyArray<string | null | undefined>;
}): Promise<SessionHistoryExportResult> {
	const sessionId = input.sessionId.trim();
	if (!sessionId) throw new Error("session id is required");
	// The id becomes part of a path; a real session id is a single segment.
	if (basename(sessionId) !== sessionId || sessionId === "..") {
		throw new Error("invalid session id");
	}
	if (!input.destinationPath.trim()) {
		throw new Error("destination path is required");
	}
	const path = resolve(input.destinationPath);
	const targetDir = dirname(path);
	if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
		throw new Error(`Destination folder not found: ${targetDir}`);
	}
	if (existsSync(path) && statSync(path).isDirectory()) {
		throw new Error(`Destination is a folder, not a file: ${path}`);
	}
	const sourcePath = resolveSessionHistoryFilePath(
		sessionId,
		input.recordedPaths,
	);
	if (!sourcePath) {
		throw new Error("No session history is stored on disk for this session.");
	}
	// Copying a file onto itself can truncate it.
	if (resolve(sourcePath) === path || isSameFile(sourcePath, path)) {
		throw new Error(
			"Choose a different location: that is the session's own history file.",
		);
	}
	const snapshot = await readSessionHistorySnapshot(sourcePath);
	await writeFile(path, snapshot);
	return { sourcePath, path, fileName: basename(path) };
}
