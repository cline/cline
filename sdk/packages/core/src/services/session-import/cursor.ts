import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
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
		this.projectsDir =
			options.projectsDir ?? join(homedir(), ".cursor", "projects");
		this.workspaceRoot = options.workspaceRoot;
	}

	isInstalled(): boolean {
		return existsSync(this.projectsDir);
	}

	private transcriptFiles(): string[] {
		if (!this.isInstalled()) return [];
		const files: string[] = [];
		const visit = (directory: string): void => {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const file = join(directory, entry.name);
				if (entry.isDirectory()) visit(file);
				else if (entry.isFile() && entry.name.endsWith(".jsonl"))
					files.push(file);
			}
		};
		visit(this.projectsDir);
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
				if (
					this.workspaceRoot &&
					parsed.cwd &&
					!workspaceMatches(parsed.cwd, this.workspaceRoot)
				)
					continue;
				const firstUser = parsed.messages.find(
					(message) => message.role === "user",
				);
				const preview = Array.isArray(firstUser?.content)
					? firstUser.content.find((block) => block.type === "text")?.text
					: undefined;
				sessions.push({
					tool: this.tool,
					sourceId: this.sourceId(file),
					sourcePath: file,
					title:
						truncateForDisplay(parsed.title ?? preview, 120) ??
						"Untitled Cursor chat",
					cwd: parsed.cwd,
					startedAtMs: parsed.startedAtMs,
					updatedAtMs: parsed.updatedAtMs,
					messageCount: parsed.messages.length,
					...(preview ? { preview: truncateForDisplay(preview) } : {}),
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
		const firstUser = parsed.messages.find(
			(message) => message.role === "user",
		);
		const prompt = Array.isArray(firstUser?.content)
			? firstUser.content.find((block) => block.type === "text")?.text
			: undefined;
		return {
			tool: this.tool,
			sourceId,
			sourcePath: file,
			title:
				truncateForDisplay(parsed.title ?? prompt, 120) ??
				"Untitled Cursor chat",
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
