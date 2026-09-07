import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

function resolveDefaultHomeDirForCursor(): string {
	const envHome = process.env.HOME?.trim();
	if (envHome && envHome !== "~") {
		return envHome;
	}
	const envUserProfile = process.env.USERPROFILE?.trim();
	if (envUserProfile) {
		return envUserProfile;
	}
	const envHomeDrive = process.env.HOMEDRIVE?.trim();
	const envHomePath = process.env.HOMEPATH?.trim();
	if (envHomeDrive && envHomePath) {
		return `${envHomeDrive}${envHomePath}`;
	}
	const osHomeDir = homedir().trim();
	if (osHomeDir && osHomeDir !== "~") {
		return osHomeDir;
	}
	return "~";
}

/** Resolve Cursor's per-user projects directory (macOS/Linux/Windows). */
export function resolveCursorProjectsDir(options?: {
	projectsDir?: string;
}): string {
	const override =
		options?.projectsDir ?? process.env.CURSOR_PROJECTS_DIR?.trim();
	if (override) {
		return override;
	}
	return join(resolveDefaultHomeDirForCursor(), ".cursor", "projects");
}
import type * as LlmsProviders from "@cline/llms";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

type JsonRecord = Record<string, unknown>;

export interface CursorAdapterOptions {
	/** Defaults to ~/.cursor/projects. */
	projectsDir?: string;
	/** Restrict discovery to a workspace when provided. */
	workspaceRoot?: string;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown): number | undefined {
	if (typeof value === "string" && value.includes("-")) {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function normalizedPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function workspaceMatches(cwd: string, workspaceRoot: string): boolean {
	const normalizedCwd = normalizedPath(cwd);
	const normalizedRoot = normalizedPath(workspaceRoot);
	return (
		normalizedCwd === normalizedRoot ||
		normalizedCwd.startsWith(`${normalizedRoot}/`) ||
		normalizedRoot.startsWith(`${normalizedCwd}/`)
	);
}

/**
 * Cursor stores per-project data under `~/.cursor/projects/<id>/…` where
 * `<id>` is the workspace path with leading slashes stripped and remaining
 * separators replaced by `-` (e.g. `/Users/ue/projects/hermes-cloud` →
 * `Users-ue-projects-hermes-cloud`). Agent transcripts often omit `cwd`, so
 * workspace scoping must use this folder id when filtering.
 */
export function cursorProjectId(workspaceRoot: string): string {
	return normalizedPath(workspaceRoot)
		.replace(/^\/+/, "")
		.replace(/^[A-Za-z]:/, (drive) => drive[0])
		.replace(/:/g, "")
		.replace(/\//g, "-");
}

function sourceBelongsToWorkspace(
	sourceIdOrPath: string,
	projectsDir: string,
	workspaceRoot: string,
): boolean {
	const projectId = cursorProjectId(workspaceRoot);
	const relativeId = sourceIdOrPath.startsWith(projectsDir)
		? relative(projectsDir, sourceIdOrPath).replace(/\\/g, "/")
		: sourceIdOrPath.replace(/\\/g, "/");
	return relativeId === projectId || relativeId.startsWith(`${projectId}/`);
}

/** Strip Cursor transcript envelope tags so History shows the real prompt. */
export function cursorTranscriptDisplayText(
	raw: string | undefined,
): string | undefined {
	if (!raw?.trim()) return undefined;
	let text = raw.trim();
	const userQuery = text.match(
		/<user_query>\s*([\s\S]*?)(?:<\/user_query>|$)/i,
	);
	if (userQuery?.[1]) {
		text = userQuery[1];
	}
	text = text.replace(/<[^>]+>/g, " ");
	text = text.replace(
		/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),[^]*?\(UTC[^)]*\)\s*/i,
		"",
	);
	const compact = text.replace(/\s+/g, " ").trim();
	return compact || undefined;
}

function promptTitle(
	storedTitle: string | undefined,
	firstUserText: string | undefined,
	max = 120,
): string {
	return (
		truncateForDisplay(
			cursorTranscriptDisplayText(storedTitle) ??
				cursorTranscriptDisplayText(firstUserText) ??
				storedTitle ??
				firstUserText,
			max,
		) ?? "Untitled Cursor chat"
	);
}

function firstUserText(
	messages: LlmsProviders.MessageWithMetadata[],
): string | undefined {
	const firstUser = messages.find((message) => message.role === "user");
	if (!firstUser || !Array.isArray(firstUser.content)) return undefined;
	return firstUser.content.find((block) => block.type === "text")?.text;
}

/**
 * Cursor Agents store one parent transcript at
 * `agent-transcripts/<uuid>/<uuid>.jsonl`. Subagent runs live under
 * `…/subagents/*.jsonl` and must not appear as separate History rows.
 */
export function isParentAgentTranscriptFile(file: string): boolean {
	const normalized = normalizedPath(file);
	if (!normalized.endsWith(".jsonl")) return false;
	if (normalized.includes("/subagents/")) return false;
	const base = normalized.slice(0, -".jsonl".length);
	const sessionId = base.slice(base.lastIndexOf("/") + 1);
	const parentDir = base.slice(0, base.lastIndexOf("/"));
	const parentName = parentDir.slice(parentDir.lastIndexOf("/") + 1);
	if (parentName !== sessionId) return false;
	const agentTranscriptsDir = parentDir.slice(0, parentDir.lastIndexOf("/"));
	return (
		agentTranscriptsDir.slice(agentTranscriptsDir.lastIndexOf("/") + 1) ===
		"agent-transcripts"
	);
}

function blocksFromContent(
	content: unknown,
	role: "user" | "assistant",
): LlmsProviders.ContentBlock[] {
	const parsed = parseJson(content);
	if (typeof parsed === "string") {
		return parsed.trim() ? [{ type: "text", text: parsed }] : [];
	}
	if (!Array.isArray(parsed)) return [];
	const blocks: LlmsProviders.ContentBlock[] = [];
	for (const value of parsed) {
		if (typeof value === "string") {
			if (value.trim()) blocks.push({ type: "text", text: value });
			continue;
		}
		if (!isRecord(value)) continue;
		const type = stringValue(value.type);
		if (
			(type === "text" || type === "input_text" || type === "output_text") &&
			stringValue(value.text)
		) {
			blocks.push({ type: "text", text: value.text as string });
		} else if (type === "thinking" || type === "reasoning") {
			const thinking = stringValue(value.thinking) ?? stringValue(value.text);
			if (thinking) blocks.push({ type: "thinking", thinking });
		} else if (
			role === "assistant" &&
			(type === "tool_use" || type === "function_call")
		) {
			const id = stringValue(value.id) ?? stringValue(value.call_id);
			if (!id) continue;
			const parsedArguments = parseJson(value.arguments);
			blocks.push({
				type: "tool_use",
				id,
				name: stringValue(value.name) ?? "tool",
				input: isRecord(value.input)
					? value.input
					: isRecord(parsedArguments)
						? parsedArguments
						: {},
			});
		} else if (
			role === "user" &&
			(type === "tool_result" || type === "function_call_output")
		) {
			const toolUseId =
				stringValue(value.tool_use_id) ?? stringValue(value.call_id);
			if (!toolUseId) continue;
			const result = value.content ?? value.output ?? "";
			blocks.push({
				type: "tool_result",
				tool_use_id: toolUseId,
				name: stringValue(value.name) ?? "tool",
				content: typeof result === "string" ? result : JSON.stringify(result),
			});
		} else if (type === "image_url" && isRecord(value.image_url)) {
			const url = stringValue(value.image_url.url);
			const comma = url?.indexOf(",") ?? -1;
			if (url?.startsWith("data:image/") && comma > 0) {
				blocks.push({
					type: "image",
					data: url.slice(comma + 1),
					mediaType: url.slice(5, url.indexOf(";")),
				});
			}
		}
	}
	return blocks;
}

function messageFromRecord(
	record: JsonRecord,
): LlmsProviders.MessageWithMetadata | undefined {
	const message = isRecord(record.message) ? record.message : record;
	const roleValue = stringValue(message.role) ?? stringValue(record.role);
	const role =
		roleValue === "assistant" || roleValue === "user" ? roleValue : undefined;
	if (!role) return undefined;
	const blocks = blocksFromContent(
		message.content ?? message.text ?? record.content ?? record.text,
		role,
	);
	if (blocks.length === 0) return undefined;
	const provider =
		stringValue(message.provider) ?? stringValue(record.provider);
	const model = stringValue(message.model) ?? stringValue(record.model);
	const ts = timestamp(record.timestamp) ?? timestamp(message.timestamp);
	return {
		role,
		content: blocks,
		...(ts ? { ts } : {}),
		...(provider && model ? { modelInfo: { id: model, provider } } : {}),
	};
}

function messageFromEvent(
	record: JsonRecord,
): LlmsProviders.MessageWithMetadata | undefined {
	const direct = messageFromRecord(record);
	if (direct) return direct;
	for (const key of ["data", "payload", "event", "item"]) {
		const nested = parseJson(record[key]);
		if (isRecord(nested)) {
			const message = messageFromRecord(nested);
			if (message) return message;
		}
	}
	return undefined;
}

interface ParsedCursorSession {
	messages: LlmsProviders.MessageWithMetadata[];
	cwd: string;
	title?: string;
	provider?: string;
	model?: string;
	startedAtMs: number;
	updatedAtMs: number;
}

export class CursorImportAdapter implements SessionImportAdapter {
	readonly tool = "cursor" as const;
	private readonly projectsDir: string;
	private readonly workspaceRoot?: string;

	constructor(options: CursorAdapterOptions = {}) {
		this.projectsDir = resolveCursorProjectsDir(options);
		this.workspaceRoot = options.workspaceRoot;
	}

	isInstalled(): boolean {
		return existsSync(this.projectsDir);
	}

	private projectDirs(): string[] {
		if (!existsSync(this.projectsDir)) return [];
		return readdirSync(this.projectsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(this.projectsDir, entry.name));
	}

	private transcriptFiles(): string[] {
		if (!this.isInstalled()) return [];
		const files: string[] = [];
		for (const projectDir of this.projectDirs()) {
			const transcriptsDir = join(projectDir, "agent-transcripts");
			if (!existsSync(transcriptsDir)) continue;
			for (const entry of readdirSync(transcriptsDir, { withFileTypes: true })) {
				if (!entry.isDirectory() || entry.name === "subagents") continue;
				const sessionFile = join(
					transcriptsDir,
					entry.name,
					`${entry.name}.jsonl`,
				);
				if (existsSync(sessionFile)) files.push(sessionFile);
			}
		}
		return files;
	}

	private parseFile(file: string): ParsedCursorSession {
		const result: ParsedCursorSession = {
			messages: [],
			cwd: "",
			startedAtMs: 0,
			updatedAtMs: 0,
		};
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			const record = parseJson(line);
			if (!isRecord(record)) continue;
			result.cwd ||=
				stringValue(record.cwd) ?? stringValue(record.workspace) ?? "";
			result.title ||= stringValue(record.title) ?? stringValue(record.name);
			result.provider ||= stringValue(record.provider);
			result.model ||= stringValue(record.model);
			const time =
				timestamp(record.timestamp) ??
				timestamp(record.createdAt) ??
				timestamp(record.created_at);
			if (time) {
				result.startedAtMs ||= time;
				result.updatedAtMs = Math.max(result.updatedAtMs, time);
			}
			const message = messageFromEvent(record);
			if (!message) continue;
			result.messages.push(message);
			if (message.modelInfo) {
				result.provider ||= message.modelInfo.provider;
				result.model ||= message.modelInfo.id;
			}
		}
		const now = Date.now();
		result.startedAtMs ||= now;
		result.updatedAtMs ||= result.startedAtMs;
		return result;
	}

	private sourceId(file: string): string {
		return relative(this.projectsDir, file)
			.replace(/\\/g, "/")
			.replace(/\.jsonl$/, "");
	}

	discover(): ImportableSessionSummary[] {
		const sessions: ImportableSessionSummary[] = [];
		for (const file of this.transcriptFiles()) {
			try {
				const parsed = this.parseFile(file);
				if (parsed.messages.length === 0) continue;
				if (this.workspaceRoot) {
					if (parsed.cwd) {
						if (!workspaceMatches(parsed.cwd, this.workspaceRoot)) continue;
					} else if (
						!sourceBelongsToWorkspace(file, this.projectsDir, this.workspaceRoot)
					) {
						continue;
					}
				}
				const previewRaw = firstUserText(parsed.messages);
				const preview =
					truncateForDisplay(
						cursorTranscriptDisplayText(previewRaw) ?? previewRaw,
					);
				const fileTimes = statSync(file);
				const updatedAtMs = fileTimes.mtimeMs;
				sessions.push({
					tool: this.tool,
					sourceId: this.sourceId(file),
					sourcePath: file,
					title: promptTitle(parsed.title, previewRaw),
					cwd: parsed.cwd,
					startedAtMs: parsed.startedAtMs || fileTimes.birthtimeMs || updatedAtMs,
					updatedAtMs,
					messageCount: parsed.messages.length,
					...(preview ? { preview } : {}),
				});
			} catch {
				// A malformed or active transcript must not hide other sessions.
			}
		}
		return sessions.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
	}

	convert(sourceId: string): ConvertedImportedSession {
		const file = this.transcriptFiles().find(
			(candidate) => this.sourceId(candidate) === sourceId,
		);
		if (!file) throw new Error(`Cursor session ${sourceId} not found`);
		const parsed = this.parseFile(file);
		if (parsed.messages.length === 0)
			throw new Error("Cursor session has no importable messages");
		const promptRaw = firstUserText(parsed.messages);
		const prompt =
			cursorTranscriptDisplayText(promptRaw) ?? promptRaw;
		return {
			tool: this.tool,
			sourceId,
			sourcePath: file,
			title: promptTitle(parsed.title, promptRaw),
			...(prompt ? { prompt } : {}),
			provider: parsed.provider ?? "cursor",
			model: parsed.model ?? "cursor-imported",
			cwd: parsed.cwd,
			startedAtMs: parsed.startedAtMs,
			endedAtMs: parsed.updatedAtMs,
			messages: parsed.messages,
		};
	}
}
