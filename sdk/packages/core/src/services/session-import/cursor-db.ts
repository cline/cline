import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as LlmsProviders from "@cline/llms";
import type { SqliteDb } from "@cline/shared/db";
import { nanoid } from "nanoid";
import {
	isTornReadError,
	openSqliteReadOnly,
	type ReadOnlySqlite,
	withReadSnapshot,
} from "./sqlite-readonly";

export const CURSOR_TOOL_RESULT_MAX_CHARS = 64 * 1024;
export const CURSOR_TRUNCATED_SUFFIX = "\n[import] truncated";
const REGISTRY_KEY = "glass.claudeCodeSessionRegistry.v1";

type JsonRecord = Record<string, unknown>;
type Row = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrapCursorUserText(raw: string): string {
	const query = raw.match(/<user_query>([\s\S]*?)(?:<\/user_query>|$)/);
	const text = (query ? query[1] : raw).replace(
		/<timestamp>[\s\S]*?<\/timestamp>/g,
		"",
	);
	return text.trim();
}

function readJson(path: string): JsonRecord | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function asMs(value: unknown): number | undefined {
	const num = Number(value);
	return Number.isFinite(num) && num > 0 ? num : undefined;
}

function latest(...values: Array<number | undefined>): number | undefined {
	const defined = values.filter((value) => value !== undefined);
	return defined.length > 0 ? Math.max(...defined) : undefined;
}

export interface CursorWorkspaceUri {
	scheme?: string;
	fsPath?: string;
	external?: string;
}

export interface CursorComposer {
	id: string;
	name?: string;
	createdAtMs: number;
	lastUpdatedAtMs?: number;
	headerCount: number;
	hasBubbles: boolean;
	modelName?: string;
	workspaceId?: string;
	uri: CursorWorkspaceUri;
	headerUri?: CursorWorkspaceUri;
	isSubagent: boolean;
	isDraft: boolean;
	isArchived: boolean;
	isClaudeCodeMirror: boolean;
	branch?: string;
}

export interface CursorBubbleHeader {
	bubbleId: string;
	type: number;
	createdAtMs?: number;
}

interface CursorBubble {
	type: number;
	text?: string;
	createdAtMs?: number;
	thinking?: string;
	toolCallId?: string;
	toolName?: string;
	toolParams?: string;
	toolRawArgs?: string;
	toolResult?: string;
	toolStatus?: string;
	toolError?: string;
	toolDecision?: string;
	inputTokens: number;
	outputTokens: number;
	modelName?: string;
	imageCount: number;
	projectDir?: string;
	workspaceUri?: string;
}

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value ? value : undefined;
const num = (value: unknown): number => Number(value) || 0;
const isoMs = (value: unknown): number | undefined => {
	if (typeof value !== "string" || !value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
};

const COMPOSER_SQL = `SELECT substr(key, 14) AS id,
	json_extract(value,'$.name') AS name,
	json_extract(value,'$.createdAt') AS createdAt,
	json_extract(value,'$.lastUpdatedAt') AS lastUpdatedAt,
	json_array_length(value,'$.fullConversationHeadersOnly') AS headerCount,
	json_extract(value,'$.modelConfig.modelName') AS modelName,
	json_extract(value,'$.workspaceIdentifier.id') AS workspaceId,
	json_extract(value,'$.workspaceIdentifier.uri.scheme') AS scheme,
	json_extract(value,'$.workspaceIdentifier.uri.fsPath') AS fsPath,
	json_extract(value,'$.workspaceIdentifier.uri.external') AS external,
	json_extract(value,'$.subagentInfo.parentComposerId') IS NOT NULL AS isSubagent,
	json_extract(value,'$.isDraft') AS isDraft,
	json_extract(value,'$.isArchived') AS isArchived,
	COALESCE(json_extract(value,'$.createdOnBranch'), json_extract(value,'$.activeBranch.branchName')) AS branch,
	EXISTS(SELECT 1 FROM cursorDiskKV b WHERE b.key = 'bubbleId:' || substr(cursorDiskKV.key, 14) || ':'
		|| json_extract(cursorDiskKV.value,'$.fullConversationHeadersOnly[0].bubbleId')) AS hasBubbles
FROM cursorDiskKV WHERE key >= ? AND key < ? AND json_valid(CAST(value AS TEXT))`;

const HEADERS_SQL = `SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent,
	json_extract(value,'$.name') AS name,
	json_extract(value,'$.workspaceIdentifier.uri.scheme') AS scheme,
	json_extract(value,'$.workspaceIdentifier.uri.fsPath') AS fsPath,
	json_extract(value,'$.workspaceIdentifier.uri.external') AS external,
	COALESCE(json_extract(value,'$.createdOnBranch'), json_extract(value,'$.activeBranch.branchName')) AS branch
FROM (SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent,
	CASE WHEN json_valid(CAST(value AS TEXT)) THEN value END AS value FROM composerHeaders)`;

const MIRRORS_SQL = `SELECT json_extract(j.value,'$.localComposerId') AS id
FROM ItemTable, json_each(ItemTable.value,'$.composerAssociations') a, json_each(a.value) j
WHERE ItemTable.key = ? AND a.type = 'array' AND j.type = 'object'`;

const BUBBLE_HEADERS_SQL = `SELECT json_extract(h.value,'$.bubbleId') AS bubbleId,
	json_extract(h.value,'$.type') AS type, json_extract(h.value,'$.createdAt') AS createdAt
FROM cursorDiskKV, json_each(cursorDiskKV.value,'$.fullConversationHeadersOnly') h
WHERE cursorDiskKV.key = ? AND json_valid(CAST(cursorDiskKV.value AS TEXT))`;

const BUBBLE_SQL = `SELECT json_extract(value,'$.type') AS type,
	json_extract(value,'$.text') AS text,
	json_extract(value,'$.createdAt') AS createdAt,
	CASE json_type(value,'$.thinking') WHEN 'text' THEN json_extract(value,'$.thinking')
		ELSE json_extract(value,'$.thinking.text') END AS thinking,
	json_extract(value,'$.toolFormerData.toolCallId') AS toolCallId,
	json_extract(value,'$.toolFormerData.name') AS toolName,
	json_extract(value,'$.toolFormerData.params') AS toolParams,
	json_extract(value,'$.toolFormerData.rawArgs') AS toolRawArgs,
	json_extract(value,'$.toolFormerData.result') AS toolResult,
	json_extract(value,'$.toolFormerData.status') AS toolStatus,
	json_extract(value,'$.toolFormerData.error') AS toolError,
	json_extract(value,'$.toolFormerData.userDecision') AS toolDecision,
	json_extract(value,'$.tokenCount.inputTokens') AS inputTokens,
	json_extract(value,'$.tokenCount.outputTokens') AS outputTokens,
	json_extract(value,'$.modelInfo.modelName') AS modelName,
	json_array_length(value,'$.images') AS imageCount,
	json_extract(value,'$.workspaceProjectDir') AS projectDir,
	json_extract(value,'$.workspaceUris[0]') AS workspaceUri
FROM cursorDiskKV WHERE key = ? AND json_valid(CAST(value AS TEXT))`;

const WORKSPACE_COMPOSERS_SQL = `SELECT json_extract(j.value,'$.composerId') AS id
FROM ItemTable, json_each(ItemTable.value,'$.allComposers') j
WHERE ItemTable.key = ? AND j.type = 'object'`;

export function cursorUriPath(
	uri: CursorWorkspaceUri | undefined,
): string | undefined {
	if (!uri || (uri.scheme && uri.scheme !== "file")) return undefined;
	if (uri.fsPath) return uri.fsPath;
	if (uri.external?.startsWith("file:")) {
		try {
			return fileURLToPath(uri.external);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function workspaceFolder(
	workspaceStorageDir: string,
	id: string | undefined,
): string | undefined {
	if (!id) return undefined;
	const folder = readJson(
		join(workspaceStorageDir, id, "workspace.json"),
	)?.folder;
	return cursorUriPath({
		external: typeof folder === "string" ? folder : undefined,
	});
}

export function readWorkspaceComposerIndex(
	workspaceStorageDir: string,
): Map<string, string> {
	const index = new Map<string, string>();
	if (!existsSync(workspaceStorageDir)) return index;
	for (const entry of readdirSync(workspaceStorageDir, {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const folder = workspaceFolder(workspaceStorageDir, entry.name);
		const dbPath = join(workspaceStorageDir, entry.name, "state.vscdb");
		if (!folder || !existsSync(dbPath)) continue;
		let handle: ReadOnlySqlite | undefined;
		try {
			handle = openSqliteReadOnly(dbPath);
			for (const row of handle.db
				.prepare(WORKSPACE_COMPOSERS_SQL)
				.all("composer.composerData")) {
				const id = str(row.id)?.toLowerCase();
				if (id && !index.has(id)) index.set(id, folder);
			}
		} catch {
			/* skip unreadable workspace db */
		} finally {
			handle?.close();
		}
	}
	return index;
}

export class CursorStore {
	private handle?: ReadOnlySqlite;

	constructor(readonly dbPath: string) {}

	close(): void {
		const handle = this.handle;
		this.handle = undefined;
		handle?.close();
	}

	read<T>(fn: (db: SqliteDb) => T): T {
		for (let attempt = 0; ; attempt++) {
			this.handle ??= openSqliteReadOnly(this.dbPath);
			const handle = this.handle;
			try {
				return withReadSnapshot(handle.db, () => fn(handle.db));
			} catch (error) {
				if (
					attempt === 0 &&
					handle.mode === "immutable" &&
					isTornReadError(error)
				) {
					this.close();
					continue;
				}
				throw error;
			}
		}
	}

	listComposers(): CursorComposer[] {
		return this.read((db) => {
			const headers = new Map<string, Row>();
			const hasHeaders = db
				.prepare(
					"SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?",
				)
				.get("composerHeaders");
			if (hasHeaders) {
				for (const row of db.prepare(HEADERS_SQL).all())
					headers.set(String(row.composerId), row);
			}
			const mirrors = new Set<string>();
			try {
				for (const row of db.prepare(MIRRORS_SQL).all(REGISTRY_KEY)) {
					if (str(row.id)) mirrors.add(String(row.id).toLowerCase());
				}
			} catch {
				/* registry absent */
			}
			const out: CursorComposer[] = [];
			for (const row of db
				.prepare(COMPOSER_SQL)
				.all("composerData:", "composerData;")) {
				const id = str(row.id);
				const createdAtMs = asMs(row.createdAt);
				if (!id || id === "empty-state-draft" || !createdAtMs) continue;
				const header = headers.get(id);
				out.push({
					id,
					name: str(row.name) ?? str(header?.name),
					createdAtMs,
					lastUpdatedAtMs: latest(
						asMs(row.lastUpdatedAt),
						asMs(header?.lastUpdatedAt),
					),
					headerCount: num(row.headerCount),
					hasBubbles: num(row.hasBubbles) === 1,
					modelName: str(row.modelName),
					workspaceId: str(row.workspaceId) ?? str(header?.workspaceId),
					uri: {
						scheme: str(row.scheme),
						fsPath: str(row.fsPath),
						external: str(row.external),
					},
					headerUri: header
						? {
								scheme: str(header.scheme),
								fsPath: str(header.fsPath),
								external: str(header.external),
							}
						: undefined,
					isSubagent:
						num(row.isSubagent) === 1 || num(header?.isSubagent) === 1,
					isDraft: num(row.isDraft) === 1,
					isArchived:
						num(row.isArchived) === 1 || num(header?.isArchived) === 1,
					isClaudeCodeMirror: mirrors.has(id.toLowerCase()),
					branch: str(row.branch) ?? str(header?.branch),
				});
			}
			return out;
		});
	}

	bubbleHeaders(composerId: string): CursorBubbleHeader[] {
		return this.read((db) =>
			db
				.prepare(BUBBLE_HEADERS_SQL)
				.all(`composerData:${composerId}`)
				.flatMap((row) => {
					const bubbleId = str(row.bubbleId);
					return bubbleId
						? [
								{
									bubbleId,
									type: num(row.type),
									createdAtMs: isoMs(row.createdAt),
								},
							]
						: [];
				}),
		);
	}

	firstUserText(
		composerId: string,
		headers: CursorBubbleHeader[],
	): string | undefined {
		const first = headers.find((header) => header.type === 1);
		if (!first) return undefined;
		return this.read((db) => this.bubble(db, composerId, first.bubbleId)?.text);
	}

	private bubble(
		db: SqliteDb,
		composerId: string,
		bubbleId: string,
	): CursorBubble | undefined {
		const row = db
			.prepare(BUBBLE_SQL)
			.get(`bubbleId:${composerId}:${bubbleId}`);
		if (!row) return undefined;
		return {
			type: num(row.type),
			text: str(row.text),
			createdAtMs: isoMs(row.createdAt),
			thinking: str(row.thinking),
			toolCallId: str(row.toolCallId),
			toolName: str(row.toolName),
			toolParams: str(row.toolParams),
			toolRawArgs: str(row.toolRawArgs),
			toolResult:
				typeof row.toolResult === "string"
					? row.toolResult || undefined
					: row.toolResult != null
						? String(row.toolResult)
						: undefined,
			toolStatus: str(row.toolStatus),
			toolError: str(row.toolError),
			toolDecision: str(row.toolDecision),
			inputTokens: num(row.inputTokens),
			outputTokens: num(row.outputTokens),
			modelName: str(row.modelName),
			imageCount: num(row.imageCount),
			projectDir: str(row.projectDir),
			workspaceUri: str(row.workspaceUri),
		};
	}

	convert(
		composer: CursorComposer,
		headers: CursorBubbleHeader[],
		unwrapUserText: (raw: string) => string,
		providerFor: (model: string) => string,
	): CursorConversion {
		return this.read((db) => {
			const messages: LlmsProviders.MessageWithMetadata[] = [];
			let model = composer.modelName;
			let sessionModel: string | undefined;
			let assistantModel = model;
			let assistantHasToolUse = false;
			let prompt: string | undefined;
			let workspaceHint: string | undefined;
			let lastTs = composer.createdAtMs;
			let assistant: LlmsProviders.ContentBlock[] = [];
			let assistantTs = lastTs;
			let inputTokens = 0;
			let outputTokens = 0;
			let pendingResults: LlmsProviders.ContentBlock[] = [];

			const flushAssistant = () => {
				if (assistant.length === 0) return;
				messages.push({
					role: "assistant",
					content: assistant,
					...(assistantModel
						? {
								modelInfo: {
									id: assistantModel,
									provider: providerFor(assistantModel),
								},
							}
						: {}),
					metrics: {
						inputTokens,
						outputTokens,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						cost: 0,
					},
					ts: assistantTs,
				});
				assistant = [];
				assistantHasToolUse = false;
				inputTokens = 0;
				outputTokens = 0;
			};
			const flushResults = () => {
				flushAssistant();
				if (pendingResults.length === 0) return;
				messages.push({ role: "user", content: pendingResults, ts: lastTs });
				pendingResults = [];
			};

			for (const header of headers) {
				const bubble = this.bubble(db, composer.id, header.bubbleId);
				if (!bubble) continue;
				lastTs = Math.max(
					lastTs,
					bubble.createdAtMs ?? header.createdAtMs ?? lastTs,
				);
				workspaceHint ??=
					bubble.projectDir ?? cursorUriPath({ external: bubble.workspaceUri });

				if (bubble.type === 1) {
					const blocks: LlmsProviders.ContentBlock[] = [];
					const text = bubble.text ? unwrapUserText(bubble.text) : "";
					if (text) blocks.push({ type: "text", text });
					if (bubble.imageCount > 0) {
						blocks.push({
							type: "text",
							text: `[import] ${bubble.imageCount} image attachment(s) not imported`,
						});
					}
					if (blocks.length === 0) continue;
					flushResults();
					if (bubble.modelName) {
						model = bubble.modelName;
						sessionModel ??= bubble.modelName;
					}
					prompt ??= text || undefined;
					messages.push({ role: "user", content: blocks, ts: lastTs });
					continue;
				}

				const blocks: LlmsProviders.ContentBlock[] = [];
				if (bubble.thinking?.trim())
					blocks.push({ type: "thinking", thinking: bubble.thinking });
				if (bubble.text?.trim())
					blocks.push({ type: "text", text: bubble.text });
				const tool = bubble.toolName ? toolBlocks(bubble) : undefined;
				if (blocks.length === 0 && !tool) continue;
				// Non-tool content after a tool call starts a new assistant turn,
				// whether or not that call produced a result.
				if (
					blocks.length > 0 &&
					(pendingResults.length > 0 || assistantHasToolUse)
				)
					flushResults();
				model = bubble.modelName ?? model;
				if (assistant.length === 0) {
					assistantTs = lastTs;
					assistantModel = model;
				}
				assistant.push(...blocks);
				if (tool) {
					assistant.push(tool.use);
					assistantHasToolUse = true;
					if (tool.result) pendingResults.push(tool.result);
				}
				inputTokens = Math.max(inputTokens, bubble.inputTokens);
				outputTokens += bubble.outputTokens;
			}
			flushResults();
			return {
				messages,
				prompt,
				model: sessionModel ?? composer.modelName,
				endedAtMs: lastTs,
				workspaceHint,
			};
		});
	}
}

export interface CursorConversion {
	messages: LlmsProviders.MessageWithMetadata[];
	prompt?: string;
	model?: string;
	endedAtMs: number;
	workspaceHint?: string;
}

function parseObject(
	value: string | undefined,
): Record<string, unknown> | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function capResult(content: string): string {
	if (content.length <= CURSOR_TOOL_RESULT_MAX_CHARS) return content;
	let end = CURSOR_TOOL_RESULT_MAX_CHARS;
	// Don't split a surrogate pair: a lone high surrogate breaks provider requests.
	const last = content.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end--;
	return content.slice(0, end) + CURSOR_TRUNCATED_SUFFIX;
}

function toolBlocks(bubble: CursorBubble): {
	use: LlmsProviders.ContentBlock;
	result?: LlmsProviders.ContentBlock;
} {
	const id = bubble.toolCallId ?? `import_${nanoid()}`;
	const name = bubble.toolName ?? "tool";
	const raw = bubble.toolParams ?? bubble.toolRawArgs;
	const input =
		parseObject(bubble.toolParams) ??
		parseObject(bubble.toolRawArgs) ??
		(raw ? { arguments: raw } : {});
	const use: LlmsProviders.ContentBlock = { type: "tool_use", id, name, input };
	const answer = (
		content: string,
		isError: boolean,
	): LlmsProviders.ContentBlock => ({
		type: "tool_result",
		tool_use_id: id,
		name,
		content: capResult(content),
		...(isError ? { is_error: true } : {}),
	});
	if (bubble.toolDecision === "rejected") {
		return {
			use,
			result: answer("[import] Tool call was rejected by the user.", true),
		};
	}
	if (bubble.toolStatus === "error") {
		return {
			use,
			result: answer(
				bubble.toolError ?? bubble.toolResult ?? "[import] Tool call failed.",
				true,
			),
		};
	}
	if (bubble.toolStatus !== "completed" || bubble.toolResult === undefined)
		return { use };
	return { use, result: answer(bubble.toolResult, false) };
}
