import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { agyConversationsDirs } from "./paths";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

/**
 * Antigravity ("agy" desktop app + CLI) stores one SQLite file per
 * conversation under ~/.gemini/<app>/conversations/<cascadeId>.db. The
 * `steps` table holds the transcript: each row's `step_payload` is a
 * protobuf blob. We decode just enough of the wire format to recover the
 * user prompt, assistant markdown, and tool calls (see step types below).
 *
 * step_type (observed on app 2.19.x):
 *   14 = user message      -> payload field 19 holds the prompt + context
 *   15 = assistant message -> payload field 20 holds markdown text + tool calls
 *   132 = tool step        -> payload field 7 holds tool name + JSON args
 */

// ── Minimal protobuf wire decoder ──────────────────────────────────────────

interface ProtoField {
	field: number;
	wireType: number;
	value: number | Uint8Array;
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
	let result = 0;
	let shift = 0;
	let pos = offset;
	for (;;) {
		if (pos >= bytes.length) return [result, pos];
		const byte = bytes[pos++];
		result |= (byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) break;
		shift += 7;
		if (shift > 63) break;
	}
	return [result, pos];
}

function decodeProto(bytes: Uint8Array): ProtoField[] {
	const fields: ProtoField[] = [];
	let pos = 0;
	while (pos < bytes.length) {
		const [key, next] = readVarint(bytes, pos);
		pos = next;
		const field = key >> 3;
		const wireType = key & 0x07;
		if (field === 0) break;
		if (wireType === 0) {
			const [value, after] = readVarint(bytes, pos);
			pos = after;
			fields.push({ field, wireType, value });
		} else if (wireType === 2) {
			const [length, after] = readVarint(bytes, pos);
			pos = after;
			const slice = bytes.subarray(pos, pos + length);
			pos += length;
			fields.push({ field, wireType, value: slice });
		} else if (wireType === 5) {
			fields.push({ field, wireType, value: bytes.subarray(pos, pos + 4) });
			pos += 4;
		} else if (wireType === 1) {
			fields.push({ field, wireType, value: bytes.subarray(pos, pos + 8) });
			pos += 8;
		} else {
			break;
		}
	}
	return fields;
}

function bytesToUtf8(value: number | Uint8Array): string | undefined {
	if (typeof value === "number") return undefined;
	try {
		return new TextDecoder("utf-8", { fatal: false }).decode(value);
	} catch {
		return undefined;
	}
}

function isPrintableText(text: string): boolean {
	if (!text) return false;
	let nonControl = 0;
	for (const ch of text.slice(0, 64)) {
		const code = ch.codePointAt(0) ?? 0;
		if (code === 9 || code === 10 || code === 13) continue;
		if (code < 32) return false;
		nonControl++;
	}
	return nonControl > 0;
}

/** Recursively collect printable string leaves from a protobuf blob. */
function collectStrings(bytes: Uint8Array, maxDepth: number): string[] {
	const out: string[] = [];
	const visit = (buf: Uint8Array, depth: number) => {
		if (depth > maxDepth) return;
		for (const field of decodeProto(buf)) {
			if (typeof field.value === "number") continue;
			const text = bytesToUtf8(field.value);
			if (text && isPrintableText(text) && text.trim().length > 0) {
				out.push(text);
			}
			if (field.value.length > 2) visit(field.value, depth + 1);
		}
	};
	visit(bytes, 0);
	return out;
}

/** Find the longest printable string leaf in a blob (assistant markdown). */
function longestText(bytes: Uint8Array): string | undefined {
	let best: string | undefined;
	for (const text of collectStrings(bytes, 8)) {
		if (!best || text.length > best.length) best = text;
	}
	return best;
}


// ── SQLite snapshot (live apps hold these open in WAL mode) ─────────────────

function toBuffer(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Buffer.isBuffer(value)) return new Uint8Array(value);
	return undefined;
}

interface AgyConversation {
	cascadeId: string;
	dbPath: string;
	steps: Array<{ idx: number; stepType: number; payload?: Uint8Array }>;
	cwd?: string;
}

export interface AgyAdapterOptions {
	/** Defaults to every existing ~/.gemini/<app>/conversations dir. */
	conversationsDirs?: string[];
}

export class AgyImportAdapter implements SessionImportAdapter {
	readonly tool = "agy-desktop" as const;
	private readonly conversationsDirs: string[];
	private snapshot?: { dir: string; dbs: Map<string, SqliteDb> };

	constructor(options: AgyAdapterOptions = {}) {
		this.conversationsDirs = options.conversationsDirs ?? agyConversationsDirs();
	}

	isInstalled(): boolean {
		return this.conversationsDirs.some(
			(dir) => existsSync(dir) && this.dbFiles(dir).length > 0,
		);
	}

	private dbFiles(dir: string): string[] {
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((name) => name.endsWith(".db"))
			.map((name) => join(dir, name));
	}

	private snapshotDb(dbPath: string): SqliteDb {
		if (!this.snapshot) {
			const dir = mkdtempSync(join(tmpdir(), "cline-agy-import-"));
			this.snapshot = { dir, dbs: new Map() };
		}
		const cached = this.snapshot.dbs.get(dbPath);
		if (cached) return cached;
		const copied = join(
			this.snapshot.dir,
			`${Buffer.from(dbPath).toString("hex")}.db`,
		);
		copyFileSync(dbPath, copied);
		for (const suffix of ["-wal", "-shm"]) {
			const sidecar = `${dbPath}${suffix}`;
			if (existsSync(sidecar)) copyFileSync(sidecar, `${copied}${suffix}`);
		}
		const db = loadSqliteDb(copied);
		this.snapshot.dbs.set(dbPath, db);
		return db;
	}

	dispose(): void {
		const snapshot = this.snapshot;
		this.snapshot = undefined;
		if (!snapshot) return;
		try {
			for (const db of snapshot.dbs.values()) db.close?.();
		} finally {
			rmSync(snapshot.dir, { recursive: true, force: true });
		}
	}

	private readConversation(dbPath: string): AgyConversation | undefined {
		let db: SqliteDb;
		try {
			db = this.snapshotDb(dbPath);
		} catch {
			return undefined;
		}
		const cascadeId = dbPath.replace(/\.db$/, "").split(/[\\/]/).pop() ?? dbPath;
		try {
			const rows = db
				.prepare(
					`SELECT idx, step_type, step_payload, task_details, metadata
					 FROM steps ORDER BY idx ASC`,
				)
				.all();
			const steps: AgyConversation["steps"] = [];
			for (const row of rows) {
				const payload =
					toBuffer(row.step_payload) ??
					toBuffer(row.task_details) ??
					toBuffer(row.metadata);
				steps.push({
					idx: Number(row.idx) || 0,
					stepType: Number(row.step_type) || 0,
					payload,
				});
			}
			return { cascadeId, dbPath, steps, cwd: this.readCwd(db) };
		} catch {
			return undefined;
		}
	}

	private readCwd(db: SqliteDb): string | undefined {
		try {
			const row = db
				.prepare(
					`SELECT data FROM trajectory_metadata_blob WHERE id = 'main' LIMIT 1`,
				)
				.get();
			const blob = toBuffer(row?.data);
			if (!blob) return undefined;
			for (const text of collectStrings(blob, 8)) {
				const match = /^file:\/\/(.+)$/.exec(text.trim());
				if (match) return match[1];
			}
		} catch {
			// ignore
		}
		return undefined;
	}

	private allConversations(): AgyConversation[] {
		const out: AgyConversation[] = [];
		for (const dir of this.conversationsDirs) {
			for (const dbPath of this.dbFiles(dir)) {
				const conversation = this.readConversation(dbPath);
				if (conversation) out.push(conversation);
			}
		}
		return out;
	}

	/**
	 * Turn an Antigravity conversation's steps into Cline messages. Antigravity
	 * interleaves user, assistant-text, and tool steps; we map user(14) and
	 * assistant(15) to messages, and surface tool steps (132) as assistant
	 * tool_use blocks (best effort — the payload is protobuf).
	 */
	private toMessages(
		conversation: AgyConversation,
	): LlmsProviders.MessageWithMetadata[] {
		const messages: LlmsProviders.MessageWithMetadata[] = [];
		let callIndex = 0;
		for (const step of conversation.steps) {
			if (!step.payload) continue;
			if (step.stepType === 14) {
				// User: field 19 carries the prompt (longest non-context string
				// that looks like the user's request, not an injected block).
				const userText = this.extractUserText(step.payload);
				if (userText) {
					messages.push({ role: "user", content: [{ type: "text", text: userText }] });
				}
				continue;
			}
			if (step.stepType === 15) {
				const text = longestText(step.payload);
				if (text && text.trim()) {
					messages.push({
						role: "assistant",
						content: [{ type: "text", text }],
					});
				}
				continue;
			}
			if (step.stepType === 132) {
				const tool = this.extractToolCall(step.payload, callIndex++);
				if (tool) {
					messages.push({
						role: "assistant",
						content: [tool],
					});
				}
				continue;
			}
		}
		return messages;
	}

	private extractUserText(payload: Uint8Array): string | undefined {
		const strings = collectStrings(payload, 10);
		// The real prompt is a top-level user message; injected context is
		// usually much longer and full of system-ish markers. Prefer the
		// longest string that isn't obviously a path/config blob.
		let best: string | undefined;
		for (const text of strings) {
			const trimmed = text.trim();
			if (!trimmed || trimmed.length < 2) continue;
			if (trimmed.startsWith("file://")) continue;
			if (/^[0-9a-f-]{36}$/i.test(trimmed)) continue;
			if (!best || trimmed.length > best.length) best = trimmed;
		}
		return best;
	}

	private extractToolCall(
		payload: Uint8Array,
		index: number,
	): LlmsProviders.ContentBlock | undefined {
		const strings = collectStrings(payload, 8);
		if (strings.length === 0) return undefined;
		// Tool name is the first short identifier-like string; args are the
		// JSON object string (if present).
		let name: string | undefined;
		let argsInput: Record<string, unknown> = {};
		for (const text of strings) {
			const trimmed = text.trim();
			if (!name && /^[a-z][a-z0-9_]{2,}$/i.test(trimmed) && !trimmed.startsWith("{")) {
				name = trimmed;
				continue;
			}
			if (trimmed.startsWith("{")) {
				try {
					const parsed = JSON.parse(trimmed) as unknown;
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						argsInput = parsed as Record<string, unknown>;
					}
				} catch {
					// keep scanning
				}
			}
		}
		if (!name) return undefined;
		return {
			type: "tool_use",
			id: `agy_${index}`,
			name,
			input: argsInput,
		};
	}

	discover(): ImportableSessionSummary[] {
		const out: ImportableSessionSummary[] = [];
		for (const conversation of this.allConversations()) {
			const messages = this.toMessages(conversation);
			const messageCount = messages.filter((m) => m.role === "user" || m.role === "assistant").length;
			if (messageCount === 0) continue;
			const firstUser = messages.find((m) => m.role === "user");
			let preview: string | undefined;
			if (firstUser && Array.isArray(firstUser.content)) {
				const text = firstUser.content.find((b) => b.type === "text");
				if (text?.type === "text") preview = truncateForDisplay(text.text);
			}
			out.push({
				tool: this.tool,
				sourceId: conversation.cascadeId,
				sourcePath: conversation.dbPath,
				title: preview ?? `Antigravity session ${conversation.cascadeId.slice(0, 8)}`,
				cwd: conversation.cwd ?? "",
				startedAtMs: this.dbMtimeMs(conversation.dbPath) ?? Date.now(),
				updatedAtMs: this.dbMtimeMs(conversation.dbPath) ?? Date.now(),
				messageCount,
				...(preview ? { preview } : {}),
			});
		}
		return out;
	}

	private dbMtimeMs(dbPath: string): number | undefined {
		try {
			const ms = statSync(dbPath).mtimeMs;
			return Number.isFinite(ms) && ms > 0 ? ms : undefined;
		} catch {
			return undefined;
		}
	}

	convert(sourceId: string): ConvertedImportedSession {
		const conversation = this.allConversations().find(
			(candidate) => candidate.cascadeId === sourceId,
		);
		if (!conversation) {
			throw new Error(`agy-desktop session ${sourceId} not found`);
		}
		const messages = this.toMessages(conversation);
		const firstUser = messages.find((m) => m.role === "user");
		let prompt: string | undefined;
		if (firstUser && Array.isArray(firstUser.content)) {
			const text = firstUser.content.find((b) => b.type === "text");
			if (text?.type === "text") prompt = text.text;
		}
		const started = this.dbMtimeMs(conversation.dbPath) ?? Date.now();
		return {
			tool: this.tool,
			sourceId: conversation.cascadeId,
			sourcePath: conversation.dbPath,
			title: truncateForDisplay(prompt, 120) ?? `Antigravity session ${conversation.cascadeId.slice(0, 8)}`,
			...(truncateForDisplay(prompt, 2000)
				? { prompt: truncateForDisplay(prompt, 2000) }
				: {}),
			provider: "gemini",
			model: "gemini",
			cwd: conversation.cwd ?? "",
			startedAtMs: started,
			endedAtMs: started,
			messages,
		};
	}
}

