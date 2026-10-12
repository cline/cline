import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { nanoid } from "nanoid";
import { opencodeDataDirs } from "./paths";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseData(value: unknown): JsonRecord | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function asMs(value: unknown): number | undefined {
	const num = Number(value);
	return Number.isFinite(num) && num > 0 ? num : undefined;
}

/** opencode provider ids that differ from Cline's for the same vendor. */
const OPENCODE_TO_CLINE_PROVIDER: Record<string, string> = {
	openai: "openai-native",
	google: "gemini",
};

function toClineProviderId(providerId: string): string {
	return OPENCODE_TO_CLINE_PROVIDER[providerId] ?? providerId;
}

export interface OpencodeAdapterOptions {
	/** Defaults to $XDG_DATA_HOME/opencode or ~/.local/share/opencode */
	dataDir?: string;
	/** Override for opencode data directories (CLI + desktop) */
	dataDirs?: string[];
}

export class OpencodeImportAdapter implements SessionImportAdapter {
	readonly tool = "opencode" as const;
	private readonly dataDirs: string[];
	private snapshot?: { dir: string; dbs: Map<string, SqliteDb> };

	constructor(options: OpencodeAdapterOptions = {}) {
		this.dataDirs = options.dataDirs ?? opencodeDataDirs();
	}

	isInstalled(): boolean {
		return this.dataDirs.some((dir) => existsSync(join(dir, "opencode.db")));
	}

	private dbPaths(): string[] {
		return this.dataDirs
			.map((dir) => join(dir, "opencode.db"))
			.filter((p) => existsSync(p));
	}

	private snapshotDb(dbPath: string): SqliteDb {
		if (!this.snapshot) {
			const dir = mkdtempSync(join(tmpdir(), "cline-opencode-import-"));
			this.snapshot = { dir, dbs: new Map() };
		}
		const cached = this.snapshot.dbs.get(dbPath);
		if (cached) return cached;
		const copied = join(this.snapshot.dir, `${Buffer.from(dbPath).toString("hex")}.db`);
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

	/**
	 * opencode keeps its database open in WAL mode while the app runs.
	 * Snapshot the db (+ WAL/SHM) into a temp dir and read the copy so we
	 * never contend with — or corrupt — the live store. The snapshot is kept
	 * for the batch (a large db copied once per imported session was the
	 * dominant cost) and released by dispose().
	 */
	
		discover(): ImportableSessionSummary[] {
		if (!this.isInstalled()) return [];
		const out: ImportableSessionSummary[] = [];
		const seenSourceIds = new Set<string>();
		for (const dbPath of this.dbPaths()) {
			const db = this.snapshotDb(dbPath);
			try {
				const counts = new Map<string, number>();
				for (const row of db
					.prepare(
						`SELECT session_id, COUNT(*) AS n FROM message GROUP BY session_id`,
					)
					.all()) {
					counts.set(String(row.session_id), Number(row.n) || 0);
				}
				const sessions = db
					.prepare(
						`SELECT id, title, directory, time_created, time_updated
						 FROM session WHERE parent_id IS NULL
						 ORDER BY time_created DESC`,
					)
					.all();
				for (const row of sessions) {
					const sourceId = String(row.id ?? "");
					if (!sourceId || seenSourceIds.has(sourceId)) continue;
					const messageCount = counts.get(sourceId) ?? 0;
					if (messageCount === 0) continue;
					seenSourceIds.add(sourceId);
					const title =
						typeof row.title === "string" && row.title.trim()
							? row.title.trim()
							: undefined;
					const needsFallback = !title || title.startsWith("New session");
					const preview = this.firstUserText(db, sourceId);
					const displayPreview = truncateForDisplay(preview);
					out.push({
						tool: this.tool,
						sourceId,
						sourcePath: dbPath,
						title:
							(needsFallback ? truncateForDisplay(preview, 120) : undefined) ??
							truncateForDisplay(title, 120) ??
							"Untitled session",
						cwd: typeof row.directory === "string" ? row.directory : "",
						startedAtMs: asMs(row.time_created) ?? Date.now(),
						updatedAtMs:
							asMs(row.time_updated) ??
							asMs(row.time_created) ??
							Date.now(),
						messageCount,
						...(displayPreview ? { preview: displayPreview } : {}),
					});
				}
			} finally {
			}
		}
		return out;
	}
	private firstUserText(db: SqliteDb, sessionId: string): string | undefined {
		const rows = db
			.prepare(
				`SELECT m.id, m.data FROM message m
				 WHERE m.session_id = ? ORDER BY m.time_created ASC, m.id ASC LIMIT 10`,
			)
			.all(sessionId);
		for (const row of rows) {
			const data = parseData(row.data);
			if (data?.role !== "user") continue;
			const parts = db
				.prepare(
					`SELECT data FROM part WHERE message_id = ? ORDER BY id ASC LIMIT 10`,
				)
				.all(String(row.id));
			for (const part of parts) {
				const partData = parseData(part.data);
				if (
					partData?.type === "text" &&
					typeof partData.text === "string" &&
					partData.text.trim() &&
					partData.synthetic !== true
				) {
					return partData.text;
				}
			}
		}
		return undefined;
	}

		convert(sourceId: string): ConvertedImportedSession {
		for (const dbPath of this.dbPaths()) {
			const db = this.snapshotDb(dbPath);
			const session = db
				.prepare(
					`SELECT id, title, directory, time_created, time_updated
					 FROM session WHERE id = ?`,
				)
				.get(sourceId);
			if (session) {
				return this.convertInDb(db, dbPath, session, sourceId);
			}
		}
		throw new Error(`opencode session ${sourceId} not found`);
	}

	/** Convert a session from a specific database. */
	private convertInDb(
		db: SqliteDb,
		dbPath: string,
		session: Record<string, unknown>,
		sourceId: string,
	): ConvertedImportedSession {
		const messageRows = db
			.prepare(
				`SELECT id, data FROM message WHERE session_id = ?
				 ORDER BY time_created ASC, id ASC`,
			)
			.all(sourceId);

		const messages: LlmsProviders.MessageWithMetadata[] = [];
		let provider: string | undefined;
		let model: string | undefined;
		let prompt: string | undefined;
		let endedAtMs: number | undefined;

		for (const row of messageRows) {
			const data = parseData(row.data);
			if (!data) continue;
			const role = data.role === "assistant" ? "assistant" : "user";
			const time = isRecord(data.time) ? data.time : undefined;
			const ts = asMs(time?.created);
			if (ts) endedAtMs = ts;

			const parts = db
				.prepare(`SELECT data FROM part WHERE message_id = ? ORDER BY id ASC`)
				.all(String(row.id))
				.map((part) => parseData(part.data))
				.filter((part): part is JsonRecord => part !== undefined);

			if (role === "user") {
				const blocks: LlmsProviders.ContentBlock[] = [];
				for (const part of parts) {
					if (part.synthetic === true) continue;
					if (part.type === "text" && typeof part.text === "string") {
						if (!part.text.trim()) continue;
						blocks.push({ type: "text", text: part.text });
						prompt = prompt ?? part.text;
					} else if (
						part.type === "file" &&
						typeof part.url === "string" &&
						part.url.startsWith("data:") &&
						typeof part.mime === "string" &&
						part.mime.startsWith("image/")
					) {
						blocks.push({
							type: "image",
							data: part.url.slice("data:".length),
							mediaType: part.mime,
						});
					}
				}
				if (blocks.length > 0) {
					messages.push({ role, content: blocks, ...(ts ? { ts } : {}) });
				}
				continue;
			}

			// Assistant message
			let providerId: string | undefined;
			let modelId: string | undefined;
			for (const part of parts) {
				if (part.type === "text" && typeof part.text === "string") {
					if (!part.text.trim()) continue;
					messages.push({ role, content: [{ type: "text", text: part.text }], ...(ts ? { ts } : {}) });
				} else if (
					part.type === "reasoning" &&
					typeof part.text === "string" &&
					part.text.trim()
				) {
					const lastMsg = messages[messages.length - 1];
					if (lastMsg && lastMsg.role === "assistant" && Array.isArray(lastMsg.content)) {
						lastMsg.content.push({ type: "thinking", thinking: part.text });
					}
				} else if (part.type === "tool") {
					const state = isRecord(part.state) ? part.state : {};
					const name = typeof part.tool === "string" ? part.tool : "tool";
					const callId =
						typeof part.callID === "string"
							? part.callID
							: `import_${nanoid()}`;
					const blocks: LlmsProviders.ContentBlock[] = [
						{
							type: "tool_use",
							id: callId,
							name,
							input: isRecord(state.input) ? state.input : {},
						},
					];
					if (providerId === undefined && typeof part.providerID === "string") {
						providerId = part.providerID.trim();
					}
					if (modelId === undefined && typeof part.modelID === "string") {
						modelId = part.modelID.trim();
					}
					if (providerId) provider = toClineProviderId(providerId);
					if (modelId) model = modelId;

					const output =
						typeof state.output === "string"
							? state.output
							: JSON.stringify(state.output ?? "");
					blocks.push({
						type: "tool_result",
						tool_use_id: callId,
						name,
						content: output,
						...(state.status === "error" ? { is_error: true } : {}),
					});
					messages.push({ role: "assistant", content: blocks, ...(ts ? { ts } : {}) });
					messages.push({ role: "user", content: blocks.slice(1) });
				}
			}
		}

		const title =
			typeof session.title === "string" && session.title.trim()
				? session.title.trim()
				: undefined;
		const needsFallback = !title || title.startsWith("New session");
		const displayPrompt = truncateForDisplay(prompt, 2000);
		return {
			tool: this.tool,
			sourceId,
			sourcePath: dbPath,
			title:
				(needsFallback ? truncateForDisplay(prompt, 120) : undefined) ??
				truncateForDisplay(title, 120) ??
				"Untitled session",
			...(displayPrompt ? { prompt: displayPrompt } : {}),
			provider: provider ?? "opencode",
			model: model ?? "opencode",
			cwd: typeof session.directory === "string" ? session.directory : "",
			startedAtMs: asMs(session.time_created) ?? Date.now(),
			endedAtMs:
				endedAtMs ??
				asMs(session.time_updated) ??
				asMs(session.time_created) ??
				Date.now(),
			messages,
		};
	}
}