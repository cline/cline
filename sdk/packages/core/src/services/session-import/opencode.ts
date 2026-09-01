import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { nanoid } from "nanoid";
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
}

export class OpencodeImportAdapter implements SessionImportAdapter {
	readonly tool = "opencode" as const;
	private readonly dbPath: string;

	constructor(options: OpencodeAdapterOptions = {}) {
		const dataDir =
			options.dataDir ??
			join(
				process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
				"opencode",
			);
		this.dbPath = join(dataDir, "opencode.db");
	}

	isInstalled(): boolean {
		return existsSync(this.dbPath);
	}

	/**
	 * opencode keeps its database open in WAL mode while the app runs.
	 * Snapshot the db (+ WAL/SHM) into a temp dir and read the copy so we
	 * never contend with — or corrupt — the live store. The snapshot is kept
	 * for the batch (a large db copied once per imported session was the
	 * dominant cost) and released by dispose().
	 */
	private snapshot?: { dir: string; db: SqliteDb };

	private openSnapshot(): SqliteDb {
		if (this.snapshot) return this.snapshot.db;
		const dir = mkdtempSync(join(tmpdir(), "cline-opencode-import-"));
		try {
			const copied = join(dir, "opencode.db");
			copyFileSync(this.dbPath, copied);
			for (const suffix of ["-wal", "-shm"]) {
				const sidecarFile = `${this.dbPath}${suffix}`;
				if (existsSync(sidecarFile)) {
					copyFileSync(sidecarFile, `${copied}${suffix}`);
				}
			}
			const db = loadSqliteDb(copied);
			this.snapshot = { dir, db };
			return db;
		} catch (error) {
			rmSync(dir, { recursive: true, force: true });
			throw error;
		}
	}

	dispose(): void {
		const snapshot = this.snapshot;
		this.snapshot = undefined;
		if (!snapshot) return;
		try {
			snapshot.db.close?.();
		} finally {
			rmSync(snapshot.dir, { recursive: true, force: true });
		}
	}

	private withDbCopy<T>(fn: (db: SqliteDb) => T): T {
		return fn(this.openSnapshot());
	}

	discover(): ImportableSessionSummary[] {
		if (!this.isInstalled()) return [];
		return this.withDbCopy((db) => {
			const counts = new Map<string, number>();
			for (const row of db
				.prepare(
					`SELECT session_id, COUNT(*) AS n FROM message GROUP BY session_id`,
				)
				.all()) {
				counts.set(String(row.session_id), Number(row.n) || 0);
			}
			const out: ImportableSessionSummary[] = [];
			const sessions = db
				.prepare(
					`SELECT id, title, directory, time_created, time_updated
					 FROM session WHERE parent_id IS NULL
					 ORDER BY time_created DESC`,
				)
				.all();
			for (const row of sessions) {
				const sourceId = String(row.id ?? "");
				const messageCount = counts.get(sourceId) ?? 0;
				if (!sourceId || messageCount === 0) continue;
				const title =
					typeof row.title === "string" && row.title.trim()
						? row.title.trim()
						: undefined;
				// opencode's placeholder titles ("New session - <date>") carry no
				// signal; fall back to the first user prompt for those.
				const needsFallback = !title || title.startsWith("New session");
				const preview = this.firstUserText(db, sourceId);
				const displayPreview = truncateForDisplay(preview);
				out.push({
					tool: this.tool,
					sourceId,
					sourcePath: this.dbPath,
					title:
						(needsFallback ? truncateForDisplay(preview, 120) : undefined) ??
						truncateForDisplay(title, 120) ??
						"Untitled session",
					cwd: typeof row.directory === "string" ? row.directory : "",
					startedAtMs: asMs(row.time_created) ?? Date.now(),
					updatedAtMs:
						asMs(row.time_updated) ?? asMs(row.time_created) ?? Date.now(),
					messageCount,
					...(displayPreview ? { preview: displayPreview } : {}),
				});
			}
			return out;
		});
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
		if (!this.isInstalled()) {
			throw new Error("opencode database not found");
		}
		return this.withDbCopy((db) => {
			const session = db
				.prepare(
					`SELECT id, title, directory, time_created, time_updated
					 FROM session WHERE id = ?`,
				)
				.get(sourceId);
			if (!session) {
				throw new Error(`opencode session ${sourceId} not found`);
			}

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
							const base64 = part.url.split(",", 2)[1];
							if (base64) {
								blocks.push({
									type: "image",
									data: base64,
									mediaType: part.mime,
								});
							}
						}
					}
					if (blocks.length > 0) {
						messages.push({
							role: "user",
							content: blocks,
							...(ts ? { ts } : {}),
						});
					}
					continue;
				}

				// Assistant: tool parts carry both the call and its result, so a
				// tool part splits the assistant message (tool_use closes it, the
				// tool_result forms the next user message) to keep the
				// user/assistant structure providers expect.
				if (typeof data.providerID === "string" && data.providerID.trim()) {
					provider = toClineProviderId(data.providerID.trim());
				}
				if (typeof data.modelID === "string" && data.modelID.trim()) {
					model = data.modelID.trim();
				}
				const modelInfo =
					provider && model ? { id: model, provider } : undefined;
				const tokens = isRecord(data.tokens) ? data.tokens : undefined;
				const cache = isRecord(tokens?.cache) ? tokens.cache : undefined;
				const metrics = tokens
					? {
							inputTokens: Number(tokens.input) || 0,
							outputTokens: Number(tokens.output) || 0,
							cacheReadTokens: Number(cache?.read) || 0,
							cacheWriteTokens: Number(cache?.write) || 0,
							cost: Number(data.cost) || 0,
						}
					: undefined;

				let blocks: LlmsProviders.ContentBlock[] = [];
				let stampedMetrics = false;
				const flushAssistant = (withMetrics: boolean) => {
					if (blocks.length === 0) return;
					messages.push({
						role: "assistant",
						content: blocks,
						...(modelInfo ? { modelInfo } : {}),
						...(withMetrics && metrics && !stampedMetrics ? { metrics } : {}),
						...(ts ? { ts } : {}),
					});
					if (withMetrics && metrics && !stampedMetrics) stampedMetrics = true;
					blocks = [];
				};

				for (const part of parts) {
					if (part.type === "text" && typeof part.text === "string") {
						if (part.text.trim())
							blocks.push({ type: "text", text: part.text });
					} else if (
						part.type === "reasoning" &&
						typeof part.text === "string" &&
						part.text.trim()
					) {
						blocks.push({ type: "thinking", thinking: part.text });
					} else if (part.type === "tool") {
						const state = isRecord(part.state) ? part.state : {};
						const name = typeof part.tool === "string" ? part.tool : "tool";
						const callId =
							typeof part.callID === "string"
								? part.callID
								: `import_${nanoid()}`;
						blocks.push({
							type: "tool_use",
							id: callId,
							name,
							input: isRecord(state.input) ? state.input : {},
						});
						flushAssistant(false);
						const output =
							typeof state.output === "string"
								? state.output
								: JSON.stringify(state.output ?? "");
						messages.push({
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: callId,
									name,
									content: output,
									...(state.status === "error" ? { is_error: true } : {}),
								},
							],
						});
					}
				}
				flushAssistant(true);
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
				sourcePath: this.dbPath,
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
		});
	}
}
