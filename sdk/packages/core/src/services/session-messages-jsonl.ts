/**
 * Session messages JSONL persistence (V18 — storage-layer root fix).
 *
 * ## Why
 *
 * The original `persistSessionMessages` wrote the whole conversation as a
 * single pretty-printed JSON array on every update (`writeFileSync`
 * `JSON.stringify(payload, null, 2)`). For long conversations (our startup-log
 * analysis found a 50MB `messages.json` with 411M input tokens) that means:
 *   - O(N) synchronous full rewrite on every persist (blocks the Node event loop)
 *   - O(N) full `JSON.parse` on read — 50MB parsed in one go while the
 *     extension host starts up.
 *
 * ## Format
 *
 * The file is JSON Lines with a **header row** followed by one message per row:
 *
 * ```
 * {"header":{"version":1,"updated_at":"...","agent":"lead","sessionId":"...","message_count":N}}
 * {"message":{...}}
 * {"message":{...}}
 * ...
 * ```
 *
 * - Appending a message is O(1) (`appendFileSync` one line, no rewrite).
 * - Reads stream line-by-line (`readline`), so memory stays flat even for
 *   huge files.
 * - When the row count reaches `compactThreshold` a Compact rewrites the file
 *   atomically (header + every message) and also emits a legacy
 *   `<id>.messages.json` mirror for old readers that don't know JSONL yet.
 *
 * ## Compatibility
 *
 * `readSessionMessagesFile` auto-detects:
 *   - JSONL file (first row has a `header` key) → streamed line-by-line read
 *   - legacy pretty-print JSON `{ messages: [...] }` → full parse (fallback)
 *
 * So pre-existing 50MB `.messages.json` files still load until the next
 * persist migrates them to JSONL (a one-time O(N) rewrite).
 */

import {
	appendFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { BasicLogger } from "@cline/shared";
import type { MessagesFileContext } from "./session-data";

export const MESSAGES_JSONL_HEADER_KEY = "header";
export const DEFAULT_COMPACT_THRESHOLD = 2000;

/**
 * Maximum length of a single JSONL row. Rows longer than this (e.g. a corrupt
 * newline-free blob or a giant embedded payload) are treated as corrupt and
 * skipped instead of letting a `carry` string balloon in memory or freezing
 * the event loop on one oversized `JSON.parse`.
 */
export const MAX_JSONL_LINE_LENGTH = 10 * 1024 * 1024; // 10MB

/**
 * Safety cap on how many tail chunks `readJsonlTailFirst` will walk before
 * giving up. Bounds the reverse scan even for pathologically large files so a
 * bad file can never make the read loop run effectively forever.
 */
export const MAX_TAIL_CHUNKS = 10_000;

export type SessionMessagesHeader = {
	version: 1;
	updated_at: string;
	agent: "lead" | "subagent" | "teammate";
	sessionId: string;
	taskType?: string;
	message_count: number;
};

export interface SessionMessageRow {
	message: unknown;
}

export type PersistedMessageLike = Record<string, unknown>;

type HeaderInput = {
	updatedAt: string;
	context: MessagesFileContext;
	messageCount: number;
};

function formatHeader(input: HeaderInput): SessionMessagesHeader {
	return {
		version: 1,
		updated_at: input.updatedAt,
		agent: input.context.agent,
		sessionId: input.context.sessionId,
		...(input.context.taskType ? { taskType: input.context.taskType } : {}),
		message_count: input.messageCount,
	};
}

export function toJsonlLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Derive the JSONL path for a session's legacy `.messages.json`.
 * e.g. `<id>.messages.json` → `<id>.messages.jsonl`.
 */
export function toJsonlMessagesPath(legacyPath: string): string {
	return legacyPath.endsWith(".json")
		? `${legacyPath}l`
		: `${legacyPath}.jsonl`;
}

/**
 * Write the header row into a JSONL messages file (creates parent dirs).
 */
export function writeMessagesHeader(
	path: string,
	input: Omit<HeaderInput, "messageCount">,
): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(
		path,
		toJsonlLine({
			[MESSAGES_JSONL_HEADER_KEY]: formatHeader({
				...input,
				messageCount: 0,
			}),
		}),
		"utf8",
	);
}

/**
 * The incremental delta between the currently persisted message count and a
 * fresh, larger message list. Returns `messages.slice(persistedCount)` — the
 * rows that have not been appended yet.
 */
export function diffNewMessages(
	messages: unknown[],
	persistedCount: number,
): unknown[] {
	if (persistedCount <= 0) return messages;
	return messages.slice(persistedCount);
}

/**
 * Count how many message rows (rows without a `header` key) currently exist in
 * a JSONL messages file. Falls back to 0 for a legacy JSON file.
 */
export async function countMessageRows(path: string): Promise<number> {
	if (!existsSync(path)) return 0;
	try {
		let count = 0;
		const reader = createInterface({
			input: createReadStream(path),
			crlfDelay: Infinity,
		});
		for await (const rawLine of reader) {
			const line = rawLine.trim();
			if (!line) continue;
			try {
				const parsed = JSON.parse(line) as unknown;
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					!(MESSAGES_JSONL_HEADER_KEY in (parsed as object))
				) {
					count++;
				}
			} catch {
				// skip torn/corrupt lines while counting
			}
		}
		return count;
	} catch {
		return 0;
	}
}

/**
 * Append the given message rows to a JSONL messages file (O(1) per call —
 * a single `appendFileSync` with the new lines).
 */
export function appendMessagesToJsonl(
	path: string,
	messages: unknown[],
	logger?: BasicLogger,
): void {
	if (messages.length === 0) return;
	try {
		appendFileSync(
			path,
			messages.map((message) => toJsonlLine({ message })).join(""),
			"utf8",
		);
	} catch (error) {
		logger?.debug("Failed to append messages to JSONL", { path, error });
		throw error;
	}
}

/**
 * Atomically compact a JSONL messages file: write every message row to a temp
 * file (header + rows), then rename over the original. Optionally also writes a
 * legacy `<id>.messages.json` mirror for readers that don't understand JSONL.
 */
export function compactMessagesJsonl(
	path: string,
	messages: unknown[],
	input: Omit<HeaderInput, "messageCount">,
	legacyMirrorPath?: string,
	logger?: BasicLogger,
): void {
	const tmpPath = `${path}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		const header = formatHeader({
			...input,
			messageCount: messages.length,
		});
		const lines = [
			toJsonlLine({ [MESSAGES_JSONL_HEADER_KEY]: header }),
			...messages.map((message) => toJsonlLine({ message })),
		];
		writeFileSync(tmpPath, lines.join(""), "utf8");
		renameSync(tmpPath, path);

		if (legacyMirrorPath) {
			const legacyPayload = {
				version: 1,
				updated_at: input.updatedAt,
				agent: input.context.agent,
				sessionId: input.context.sessionId,
				...(input.context.taskType ? { taskType: input.context.taskType } : {}),
				messages,
			};
			writeFileSync(
				legacyMirrorPath,
				`${JSON.stringify(legacyPayload, null, 2)}\n`,
				"utf8",
			);
		}
	} catch (error) {
		logger?.debug("Failed to compact messages JSONL", { path, error });
		try {
			if (existsSync(tmpPath)) {
				// best-effort cleanup
				renameSync(tmpPath, path);
			}
		} catch {
			// ignore cleanup failure
		}
		throw error;
	}
}

function detectJsonl(path: string): boolean {
	try {
		const raw = readFileSync(path, "utf8");
		const newlineIndex = raw.indexOf("\n");
		const firstLine = raw
			.slice(0, newlineIndex === -1 ? raw.length : newlineIndex)
			.trim();
		if (!firstLine) return false;
		const parsed = JSON.parse(firstLine) as unknown;
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			MESSAGES_JSONL_HEADER_KEY in (parsed as object)
		);
	} catch {
		return false;
	}
}

/**
 * True when the file exists and is a JSONL messages file (first row has a
 * `header` key). False for missing files, legacy pretty-printed JSON, or any
 * parse error.
 */
export function isJsonlFile(path: string): boolean {
	if (!existsSync(path)) return false;
	try {
		return detectJsonl(path);
	} catch {
		return false;
	}
}

/**
 * Ensure a JSONL header is the FIRST row of the file. If the file is missing or
 * contains a pre-existing legacy pretty-printed JSON (e.g. written by
 * `initializeMessagesFile` → `writeEmptyMessagesFile`), the file is OVERWRITTEN
 * with just the header (migrating in place). If it already starts with a JSONL
 * header, this is a no-op.
 *
 * Returns true when the header was (re)written, false when it already existed.
 */
export function ensureJsonlHeader(
	path: string,
	input: Omit<HeaderInput, "messageCount">,
): boolean {
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path) && detectJsonl(path)) {
		return false;
	}
	// Missing file, or legacy JSON: write (or overwrite) with just the header.
	const header = toJsonlLine({
		[MESSAGES_JSONL_HEADER_KEY]: formatHeader({
			...input,
			messageCount: 0,
		}),
	});
	writeFileSync(path, header, "utf8");
	return true;
}

/**
 * Synchronously read a JSONL file's HEADER row ({@link SessionMessagesHeader}).
 * Returns `undefined` for legacy pretty-printed JSON files or on any error.
 * Primarily used by tests and migration helpers.
 */
export function readJsonlHeaderSync(
	path: string,
): SessionMessagesHeader | undefined {
	if (!existsSync(path) || !detectJsonl(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8");
		const newlineIndex = raw.indexOf("\n");
		const firstLine = raw
			.slice(0, newlineIndex === -1 ? raw.length : newlineIndex)
			.trim();
		if (!firstLine) return undefined;
		const parsed = JSON.parse(firstLine) as {
			header?: SessionMessagesHeader;
		};
		return parsed.header;
	} catch {
		return undefined;
	}
}

/**
 * Synchronously read a JSONL file's message rows only (skip the header row).
 * Returns `[]` for legacy pretty-printed JSON files (detectJsonl===false) or on
 * any read/parse error. Primarily used by tests and migration helpers; the
 * runtime read path uses the async {@link readSessionMessagesFile}.
 */
export function readJsonlMessagesSync(path: string): PersistedMessageLike[] {
	if (!existsSync(path) || !detectJsonl(path)) return [];
	const messages: PersistedMessageLike[] = [];
	try {
		const raw = readFileSync(path, "utf8");
		for (const rawLine of raw.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line) continue;
			try {
				const parsed = JSON.parse(line) as unknown;
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					MESSAGES_JSONL_HEADER_KEY in (parsed as object)
				) {
					continue;
				}
				const message = (parsed as SessionMessageRow).message;
				if (message !== undefined) {
					messages.push(message as PersistedMessageLike);
				}
			} catch {
				// skip torn/corrupt rows
			}
		}
		return messages;
	} catch {
		return [];
	}
}

/**
 * Split a raw string into complete JSON lines (no trailing newline).
 */
function splitLines(raw: string): string[] {
	return raw.split(/\r?\n/);
}

/**
 * Read a session messages file back to a message array.
 *
 * Auto-detects format:
 *  - JSONL (first non-empty row has a `header` key) → streamed line-by-line
 *    parse (flat memory even for huge files).
 *  - Legacy pretty-printed JSON `{ messages: [...] }` → **chunked** parse:
 *    reads the file in bounded chunks off the event-loop thread and streams
 *    the message array out in reverse (most recent first) then reorders, so
 *    a 50MB legacy conversation never blocks the extension-host main loop.
 *
 * `startFromEnd` (default true) reads from the END of the file backwards —
 * matching how the webview consumes transcripts (most recent messages first
 * with scroll-up pagination for older ones). For an unbounded full read
 * (used by history hydration / model reseeding) it still returns all rows.
 */
export async function readSessionMessagesFile(
	path?: string | null,
	options?: { limit?: number; startFromEnd?: boolean; chunkSizeBytes?: number },
): Promise<PersistedMessageLike[]> {
	const filePath = path?.trim();
	if (!filePath || !existsSync(filePath)) return [];

	const startFromEnd = options?.startFromEnd ?? true;
	const limit = options?.limit ?? 50;
	const chunkSizeBytes = options?.chunkSizeBytes ?? 64 * 1024; // 64KB chunks

	if (!detectJsonl(filePath)) {
		// Legacy pretty-printed JSON: async readFile (off event loop) then
		// JSON.parse in one go — still one-shot but non-blocking on the main
		// thread because we await the read.
		try {
			const raw = (await readFileAsync(filePath, "utf8")).trim();
			if (!raw) return [];
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed as PersistedMessageLike[];
			}
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const messages = (parsed as { messages?: unknown }).messages;
				if (Array.isArray(messages)) {
					return messages as PersistedMessageLike[];
				}
			}
			return [];
		} catch {
			return [];
		}
	}

	// JSONL: streamed read (whole file, oldest→newest) — flat memory.
	// For startFromEnd we walk the tail chunks in reverse so the most recent
	// messages arrive first (pagination-friendly), but still return the full
	// ordered list (callers that only hydrate the tail slice can slice it).
	if (startFromEnd) {
		return readJsonlTailFirst(filePath, chunkSizeBytes, limit);
	}

	const messages: PersistedMessageLike[] = [];
	try {
		const reader = createInterface({
			input: createReadStream(filePath),
			crlfDelay: Infinity,
		});
		for await (const rawLine of reader) {
			const line = rawLine.trim();
			if (!line) continue;
			try {
				const parsed = JSON.parse(line) as unknown;
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					MESSAGES_JSONL_HEADER_KEY in (parsed as object)
				) {
					continue;
				}
				const message = (parsed as SessionMessageRow).message;
				if (message !== undefined) {
					messages.push(message as PersistedMessageLike);
				}
			} catch {
				// skip torn/corrupt rows (compaction will clean them up)
			}
		}
		return messages;
	} catch {
		return [];
	}
}

/**
 * Read a JSONL file from the END backwards in bounded chunks, returning the
 * full message list in chronological order while never buffering the whole
 * file at once. Chunks are processed tail-first so the most recent messages
 * are parsed before older ones (scroll-up pagination / startup hydration
 * only needs the tail).
 *
 * A 50MB file is read as ~200 chunks of 256KB instead of one blocking
 * `readFileSync` + `JSON.parse`.
 */
export async function readJsonlTailFirst(
	path: string,
	chunkSizeBytes = 64 * 1024,
	limit = 50,
): Promise<PersistedMessageLike[]> {
	const { size } = await statAsync(path);
	if (size <= 0) return [];

	// Tail-first: parse the last chunk, then walk towards the front.
	// Because a message row can straddle a chunk boundary, we keep a
	// `carry` of the partial line start when moving backwards: we prepend
	// the carried remainder to the next chunk's end.
	// Stops once `limit` message rows have been collected — the most recent
	// messages first (pagination-friendly).
	//
	// Resource safety (V19 hardening):
	//  - A SINGLE FileHandle is opened once and reused across all chunks;
	//    closing it in `finally` avoids the per-chunk `open`/`close` syscall
	//    storm that could exhaust file descriptors / stall the libuv pool.
	//  - `MAX_TAIL_CHUNKS` caps the reverse walk so a pathologically large or
	//    corrupt file can never make the loop run effectively forever.
	//  - `MAX_JSONL_LINE_LENGTH` bounds the `carry` join so a corrupt
	//    newline-free blob can't balloon memory or freeze `JSON.parse`.
	const messages: PersistedMessageLike[] = [];
	let end = size;
	let carry = ""; // bytes that belong to the previous (earlier) chunk's tail
	const seen = new Set<string>();

	const handle = await openAsync(path, "r");
	try {
		let chunksRead = 0;
		while (end > 0 && messages.length < limit && chunksRead < MAX_TAIL_CHUNKS) {
			chunksRead++;
			const start = Math.max(0, end - chunkSizeBytes);
			const buf = await readChunkAsync(handle, start, end - start);
			const text = buf.toString("utf8");

			// Split the current chunk into lines (working backwards).
			const headCarry = text.startsWith("\n") ? "" : text.split("\n").shift() ?? "";
			const body = text.slice(headCarry.length);
			const lines = splitLines(body);

			// Combine with carry from the previous (later) iteration: that carry
			// is the un-terminated head of the NEXT-later chunk, i.e. the tail of
			// THIS chunk. Prepend it to the last line we produce here.
			let chunkLines: string[];
			if (carry) {
				const last = lines.pop() ?? "";
				const joined = `${last}${carry}`;
				if (joined.length > MAX_JSONL_LINE_LENGTH) {
					// Corrupt / adversarial: a single logical row exceeds the
					// cap. Drop the join instead of letting `carry` balloon.
					chunkLines = lines;
				} else {
					chunkLines = [...lines, joined];
				}
			} else {
				chunkLines = lines;
			}

			// Parse this chunk's complete lines, skip header/corrupt, dedupe.
			for (let i = chunkLines.length - 1; i >= 0; i--) {
				const line = chunkLines[i].trim();
				if (!line) continue;
				if (line.length > MAX_JSONL_LINE_LENGTH) {
					// Oversized single row (corrupt newline-free blob) — skip
					// without attempting an expensive `JSON.parse`.
					continue;
				}
				try {
					const parsed = JSON.parse(line) as unknown;
					if (
						typeof parsed !== "object" ||
						parsed === null ||
						MESSAGES_JSONL_HEADER_KEY in (parsed as object)
					) {
						continue;
					}
					const message = (parsed as SessionMessageRow).message;
					if (message === undefined) continue;
					const key = JSON.stringify(message);
					if (seen.has(key)) continue;
					seen.add(key);
					messages.push(message as PersistedMessageLike);
					if (messages.length >= limit) {
						// Tail window filled mid-chunk — stop collecting so a
						// single chunk larger than the window can't overshoot.
						break;
					}
				} catch {
					// skip torn lines (dedup handles the straddling case)
				}
			}

			// Reject an oversized carry before it becomes the head of an even
			// earlier chunk (guards the next iteration's join as well).
			if (headCarry.length > MAX_JSONL_LINE_LENGTH) {
				carry = "";
			} else {
				carry = headCarry;
			}
			end = start;
		}
	} finally {
		// Always release the single file handle, even on parse errors above.
		try {
			await handle.close();
		} catch {
			// closing is best-effort; ignore any release error
		}
	}
	// If a carry remains after the first chunk (the very first line), it is
	// the header row — drop it.
	// Reverse: tail-first produced most-recent→oldest; flip to chronological.
	return messages.reverse();
}

/** Async read of a byte range reusing an already-open file handle. */
async function readChunkAsync(
	handle: {
		read(buf: Buffer, off: number, len: number, pos: number): Promise<{ bytesRead: number }>;
	},
	position: number,
	length: number,
): Promise<Buffer> {
	const buf = Buffer.alloc(length);
	const { bytesRead } = await handle.read(buf, 0, length, position);
	// A partial read (e.g. the final chunk when the file size is not a
	// multiple of the chunk size) leaves 0x00 padding past `bytesRead` —
	// slice it off so the UTF-8 decode never sees NUL bytes.
	return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

/** Async file stat via fs/promises. */
async function statAsync(path: string): Promise<{ size: number }> {
	const fsPromises = await import("node:fs/promises");
	return fsPromises.stat(path);
}

/** Async full read via fs/promises (off event-loop thread). */
async function readFileAsync(path: string, encoding: "utf8"): Promise<string> {
	const fsPromises = await import("node:fs/promises");
	return fsPromises.readFile(path, encoding);
}

/**
 * Async open for chunk reads.
 */
async function openAsync(path: string, flags: string): Promise<{
	read(buf: Buffer, off: number, len: number, pos: number): Promise<{ bytesRead: number }>;
	close(): Promise<void>;
}> {
	const fsPromises = await import("node:fs/promises");
	return fsPromises.open(path, flags);
}
