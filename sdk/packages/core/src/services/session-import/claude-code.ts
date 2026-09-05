import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

type JsonRecord = Record<string, unknown>;

interface ClaudeCodeLine {
	type?: string;
	uuid?: string;
	parentUuid?: string | null;
	isSidechain?: boolean;
	isMeta?: boolean;
	cwd?: string;
	gitBranch?: string;
	timestamp?: string;
	message?: JsonRecord;
	aiTitle?: string;
	summary?: string;
	leafUuid?: string;
}

/** Wrapper prefixes Claude Code uses for non-conversational user lines. */
const SKIPPED_USER_TEXT_PREFIXES = [
	"<command-name>",
	"<local-command-stdout>",
	"<local-command-stderr>",
	"<command-message>",
	"<local-command-caveat>",
];

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(line: string): ClaudeCodeLine | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isRecord(parsed) ? (parsed as ClaudeCodeLine) : undefined;
	} catch {
		return undefined;
	}
}

function isSkippedUserText(text: string): boolean {
	const trimmed = text.trimStart();
	return SKIPPED_USER_TEXT_PREFIXES.some((prefix) =>
		trimmed.startsWith(prefix),
	);
}

function isConversationLine(line: ClaudeCodeLine): boolean {
	return (
		(line.type === "user" || line.type === "assistant") &&
		line.isSidechain !== true &&
		typeof line.uuid === "string" &&
		isRecord(line.message)
	);
}

function firstUserText(line: ClaudeCodeLine): string | undefined {
	const content = line.message?.content;
	if (typeof content === "string") {
		return isSkippedUserText(content) ? undefined : content;
	}
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (
			isRecord(block) &&
			block.type === "text" &&
			typeof block.text === "string"
		) {
			if (!isSkippedUserText(block.text)) return block.text;
		}
	}
	return undefined;
}

function toolResultContent(
	value: unknown,
): LlmsProviders.ToolResultContent["content"] {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return JSON.stringify(value ?? "");
	const blocks: Array<LlmsProviders.TextContent | LlmsProviders.ImageContent> =
		[];
	for (const item of value) {
		if (!isRecord(item)) continue;
		if (item.type === "text" && typeof item.text === "string") {
			blocks.push({ type: "text", text: item.text });
		} else if (item.type === "image" && isRecord(item.source)) {
			const source = item.source;
			if (
				source.type === "base64" &&
				typeof source.data === "string" &&
				typeof source.media_type === "string"
			) {
				blocks.push({
					type: "image",
					data: source.data,
					mediaType: source.media_type,
				});
			}
		}
	}
	return blocks.length > 0 ? blocks : JSON.stringify(value);
}

function convertBlocks(
	content: unknown,
	role: "user" | "assistant",
	toolNames: Map<string, string>,
): LlmsProviders.ContentBlock[] {
	if (typeof content === "string") {
		if (role === "user" && isSkippedUserText(content)) return [];
		return content.trim() ? [{ type: "text", text: content }] : [];
	}
	if (!Array.isArray(content)) return [];
	const blocks: LlmsProviders.ContentBlock[] = [];
	for (const raw of content) {
		if (!isRecord(raw)) continue;
		switch (raw.type) {
			case "text":
				if (typeof raw.text === "string" && raw.text.trim()) {
					if (role === "user" && isSkippedUserText(raw.text)) break;
					blocks.push({ type: "text", text: raw.text });
				}
				break;
			case "thinking":
				if (typeof raw.thinking === "string" && raw.thinking.trim()) {
					blocks.push({ type: "thinking", thinking: raw.thinking });
				}
				break;
			case "tool_use":
				if (typeof raw.id === "string" && typeof raw.name === "string") {
					toolNames.set(raw.id, raw.name);
					blocks.push({
						type: "tool_use",
						id: raw.id,
						name: raw.name,
						input: isRecord(raw.input) ? raw.input : {},
					});
				}
				break;
			case "tool_result":
				if (typeof raw.tool_use_id === "string") {
					blocks.push({
						type: "tool_result",
						tool_use_id: raw.tool_use_id,
						name: toolNames.get(raw.tool_use_id) ?? "",
						content: toolResultContent(raw.content),
						...(raw.is_error === true ? { is_error: true } : {}),
					});
				}
				break;
			case "image": {
				const source = isRecord(raw.source) ? raw.source : undefined;
				if (
					source?.type === "base64" &&
					typeof source.data === "string" &&
					typeof source.media_type === "string"
				) {
					blocks.push({
						type: "image",
						data: source.data,
						mediaType: source.media_type,
					});
				}
				break;
			}
			default:
				break;
		}
	}
	return blocks;
}

/**
 * Claude Code session files are event logs where lines form a tree via
 * parentUuid (message edits and retries create branches). The active
 * conversation is the parent chain ending at the most recent line, so we walk
 * backwards from the file's last conversation line and reverse. The chain
 * passes through non-conversation lines too (attachment, system, meta), so
 * every uuid-bearing line participates in the walk; emission filters later.
 */
function reconstructThread(lines: ClaudeCodeLine[]): ClaudeCodeLine[] {
	const byUuid = new Map<string, ClaudeCodeLine>();
	let leaf: ClaudeCodeLine | undefined;
	for (const line of lines) {
		if (typeof line.uuid !== "string" || line.isSidechain === true) continue;
		byUuid.set(line.uuid, line);
		if (isConversationLine(line)) leaf = line;
	}
	if (!leaf) return [];
	const thread: ClaudeCodeLine[] = [];
	const seen = new Set<string>();
	let current: ClaudeCodeLine | undefined = leaf;
	while (current) {
		const uuid = current.uuid as string;
		if (seen.has(uuid)) break;
		seen.add(uuid);
		thread.push(current);
		current =
			typeof current.parentUuid === "string"
				? byUuid.get(current.parentUuid)
				: undefined;
	}
	return thread.reverse();
}

export interface ClaudeCodeAdapterOptions {
	/** Defaults to ~/.claude/projects */
	projectsDir?: string;
}

export class ClaudeCodeImportAdapter implements SessionImportAdapter {
	readonly tool = "claude-code" as const;
	private readonly projectsDir: string;

	constructor(options: ClaudeCodeAdapterOptions = {}) {
		this.projectsDir =
			options.projectsDir ?? join(homedir(), ".claude", "projects");
	}

	isInstalled(): boolean {
		return existsSync(this.projectsDir);
	}

	private sessionFiles(): string[] {
		if (!this.isInstalled()) return [];
		const files: string[] = [];
		for (const project of readdirSync(this.projectsDir, {
			withFileTypes: true,
		})) {
			if (!project.isDirectory()) continue;
			const projectDir = join(this.projectsDir, project.name);
			for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
				if (entry.isFile() && entry.name.endsWith(".jsonl")) {
					files.push(join(projectDir, entry.name));
				}
			}
		}
		return files;
	}

	private findSessionFile(sourceId: string): string | undefined {
		return this.sessionFiles().find(
			(file) => basename(file, ".jsonl") === sourceId,
		);
	}

	discover(): ImportableSessionSummary[] {
		const out: ImportableSessionSummary[] = [];
		for (const file of this.sessionFiles()) {
			try {
				const summary = this.summarizeFile(file);
				if (summary) out.push(summary);
			} catch {
				// A single corrupt session log never blocks discovery.
			}
		}
		return out;
	}

	private summarizeFile(file: string): ImportableSessionSummary | undefined {
		const raw = readFileSync(file, "utf8");
		let messageCount = 0;
		let assistantCount = 0;
		let title: string | undefined;
		let summaryTitle: string | undefined;
		let preview: string | undefined;
		let cwd = "";
		let firstTs: number | undefined;
		let lastTs: number | undefined;
		for (const rawLine of raw.split("\n")) {
			const line = parseLine(rawLine);
			if (!line) continue;
			if (line.type === "ai-title" && typeof line.aiTitle === "string") {
				title = line.aiTitle;
				continue;
			}
			if (line.type === "summary" && typeof line.summary === "string") {
				summaryTitle = line.summary;
				continue;
			}
			if (!isConversationLine(line)) continue;
			if (line.isMeta === true) continue;
			if (line.type === "user" && !preview) {
				preview = firstUserText(line);
			}
			if (line.type === "assistant") assistantCount++;
			messageCount++;
			if (!cwd && typeof line.cwd === "string") cwd = line.cwd;
			const ts = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
			if (Number.isFinite(ts)) {
				firstTs = firstTs ?? ts;
				lastTs = ts;
			}
		}
		// Sessions with neither an assistant reply nor real user text are
		// slash-command shells (/fast and friends) — nothing to import.
		if (messageCount === 0 || (assistantCount === 0 && !preview)) {
			return undefined;
		}
		const displayPreview = truncateForDisplay(preview);
		return {
			tool: this.tool,
			sourceId: basename(file, ".jsonl"),
			sourcePath: file,
			title:
				truncateForDisplay(title ?? summaryTitle, 120) ??
				truncateForDisplay(preview, 120) ??
				"Untitled session",
			cwd,
			startedAtMs: firstTs ?? Date.now(),
			updatedAtMs: lastTs ?? firstTs ?? Date.now(),
			messageCount,
			...(displayPreview ? { preview: displayPreview } : {}),
		};
	}

	convert(sourceId: string): ConvertedImportedSession {
		const file = this.findSessionFile(sourceId);
		if (!file) {
			throw new Error(`Claude Code session ${sourceId} not found`);
		}
		const raw = readFileSync(file, "utf8");
		const lines = raw
			.split("\n")
			.map(parseLine)
			.filter((line): line is ClaudeCodeLine => line !== undefined);

		const thread = reconstructThread(lines);
		const toolNames = new Map<string, string>();
		const messages: LlmsProviders.MessageWithMetadata[] = [];
		let cwd = "";
		let gitBranch: string | undefined;
		let model: string | undefined;
		let firstTs: number | undefined;
		let lastTs: number | undefined;
		let prompt: string | undefined;

		for (const line of thread) {
			if (!isConversationLine(line) || line.isMeta === true) continue;
			const role = line.type === "assistant" ? "assistant" : "user";
			const blocks = convertBlocks(line.message?.content, role, toolNames);
			if (blocks.length === 0) continue;

			if (!cwd && typeof line.cwd === "string") cwd = line.cwd;
			if (!gitBranch && typeof line.gitBranch === "string" && line.gitBranch) {
				gitBranch = line.gitBranch;
			}
			const ts = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
			if (Number.isFinite(ts)) {
				firstTs = firstTs ?? ts;
				lastTs = ts;
			}
			if (role === "user" && !prompt) {
				const text = blocks.find((block) => block.type === "text");
				if (text?.type === "text") prompt = text.text;
			}

			const lineModel =
				typeof line.message?.model === "string"
					? line.message.model
					: undefined;
			// "<synthetic>" marks locally generated error notices, not API output.
			const realModel =
				lineModel && !lineModel.startsWith("<") ? lineModel : undefined;
			if (realModel) model = realModel;

			// Claude Code streams one API turn across several assistant lines
			// sharing message.id; merge them back into a single message.
			const previous = messages[messages.length - 1];
			const messageId =
				typeof line.message?.id === "string" ? line.message.id : undefined;
			if (
				role === "assistant" &&
				previous?.role === "assistant" &&
				messageId &&
				previous.metadata?.sourceMessageId === messageId &&
				Array.isArray(previous.content)
			) {
				previous.content = [...previous.content, ...blocks];
				continue;
			}

			const message: LlmsProviders.MessageWithMetadata = {
				role,
				content: blocks,
				...(Number.isFinite(ts) ? { ts } : {}),
			};
			if (role === "assistant") {
				if (messageId) message.metadata = { sourceMessageId: messageId };
				if (realModel) {
					message.modelInfo = { id: realModel, provider: "anthropic" };
				}
				const usage = isRecord(line.message?.usage)
					? line.message.usage
					: undefined;
				if (usage) {
					message.metrics = {
						inputTokens: Number(usage.input_tokens) || 0,
						outputTokens: Number(usage.output_tokens) || 0,
						cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
						cacheWriteTokens: Number(usage.cache_creation_input_tokens) || 0,
						cost: 0,
					};
				}
			}
			messages.push(message);
		}

		// The merge marker is internal; drop it before persistence.
		for (const message of messages) {
			if (message.metadata && "sourceMessageId" in message.metadata) {
				delete message.metadata.sourceMessageId;
				if (Object.keys(message.metadata).length === 0) {
					delete message.metadata;
				}
			}
		}

		const summary = this.summarizeFile(file);
		return {
			tool: this.tool,
			sourceId,
			sourcePath: file,
			title: summary?.title ?? "Untitled session",
			...(truncateForDisplay(prompt, 2000)
				? { prompt: truncateForDisplay(prompt, 2000) }
				: {}),
			provider: "anthropic",
			model: model ?? "claude",
			cwd,
			...(gitBranch ? { gitBranch } : {}),
			startedAtMs: firstTs ?? Date.now(),
			endedAtMs: lastTs ?? firstTs ?? Date.now(),
			messages,
		};
	}
}
