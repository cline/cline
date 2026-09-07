import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import { nanoid } from "nanoid";
import {
	type ConvertedImportedSession,
	type ImportableSessionSummary,
	type SessionImportAdapter,
	truncateForDisplay,
} from "./types";

type JsonRecord = Record<string, unknown>;

interface CodexLine {
	timestamp?: string;
	type?: string;
	payload?: JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(line: string): CodexLine | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isRecord(parsed) ? (parsed as CodexLine) : undefined;
	} catch {
		return undefined;
	}
}

function messageText(payload: JsonRecord): string {
	const content = payload.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(isRecord)
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.filter((text) => text.trim().length > 0)
		.join("\n");
}

/**
 * Tool outputs are a plain string in older rollouts, but newer Codex writes
 * custom_tool_call_output.output as Responses-API content blocks
 * ({type:"input_text", text}). Flatten those to text so the transcript holds
 * the real output instead of a JSON-encoded block list.
 */
function toolOutputText(output: unknown): string {
	if (typeof output === "string") return output;
	if (Array.isArray(output)) {
		const parts: string[] = [];
		for (const item of output) {
			if (typeof item === "string") {
				parts.push(item);
			} else if (isRecord(item) && typeof item.text === "string") {
				parts.push(item.text);
			}
		}
		if (parts.length > 0 || output.length === 0) return parts.join("");
	}
	return JSON.stringify(output ?? "");
}

/** Context Codex injects as user-role response items, not typed by a person. */
function isInjectedUserContext(text: string): boolean {
	const trimmed = text.trimStart();
	return (
		trimmed.startsWith("<user_instructions>") ||
		trimmed.startsWith("<environment_context>") ||
		trimmed.startsWith("<ENVIRONMENT_CONTEXT>") ||
		trimmed.startsWith("<turn_aborted>") ||
		trimmed.startsWith("# AGENTS.md instructions") ||
		trimmed.startsWith("<INSTRUCTIONS>")
	);
}

interface CodexFileMeta {
	sessionId?: string;
	cwd: string;
	gitBranch?: string;
	model?: string;
	startedAtMs?: number;
	endedAtMs?: number;
	userMessageCount: number;
	/** User-role response items that aren't injected context (fallback for
	 * rollouts without user_message events). */
	fallbackUserCount: number;
	assistantEventCount: number;
	firstUserText?: string;
}

function scanFileMeta(raw: string): CodexFileMeta {
	const meta: CodexFileMeta = {
		cwd: "",
		userMessageCount: 0,
		fallbackUserCount: 0,
		assistantEventCount: 0,
	};
	for (const rawLine of raw.split("\n")) {
		const line = parseLine(rawLine);
		if (!line?.payload) continue;
		const ts = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
		if (Number.isFinite(ts)) {
			meta.startedAtMs = meta.startedAtMs ?? ts;
			meta.endedAtMs = ts;
		}
		const payload = line.payload;
		if (line.type === "session_meta") {
			if (typeof payload.id === "string") meta.sessionId = payload.id;
			if (typeof payload.cwd === "string") meta.cwd = payload.cwd;
			const git = isRecord(payload.git) ? payload.git : undefined;
			if (typeof git?.branch === "string") meta.gitBranch = git.branch;
			continue;
		}
		if (line.type === "turn_context") {
			if (typeof payload.model === "string") meta.model = payload.model;
			if (!meta.cwd && typeof payload.cwd === "string") meta.cwd = payload.cwd;
			continue;
		}
		if (line.type === "event_msg" && payload.type === "user_message") {
			const text = typeof payload.message === "string" ? payload.message : "";
			if (text.trim()) {
				meta.userMessageCount++;
				meta.firstUserText = meta.firstUserText ?? text;
			}
			continue;
		}
		if (line.type === "response_item" && payload.type === "message") {
			if (payload.role === "assistant") {
				meta.assistantEventCount++;
			} else if (payload.role === "user") {
				const text = messageText(payload);
				if (text.trim() && !isInjectedUserContext(text)) {
					meta.fallbackUserCount++;
					meta.firstUserText = meta.firstUserText ?? text;
				}
			}
		}
	}
	return meta;
}

export interface CodexAdapterOptions {
	/** Defaults to $CODEX_HOME or ~/.codex */
	codexHome?: string;
}

export class CodexImportAdapter implements SessionImportAdapter {
	readonly tool = "codex" as const;
	private readonly codexHome: string;

	constructor(options: CodexAdapterOptions = {}) {
		this.codexHome =
			options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
	}

	private get sessionsDir(): string {
		return join(this.codexHome, "sessions");
	}

	isInstalled(): boolean {
		return existsSync(this.sessionsDir);
	}

	/** thread_name by session id, from Codex's own index. */
	private readTitleIndex(): Map<string, string> {
		const titles = new Map<string, string>();
		const indexPath = join(this.codexHome, "session_index.jsonl");
		if (!existsSync(indexPath)) return titles;
		try {
			for (const rawLine of readFileSync(indexPath, "utf8").split("\n")) {
				const line = parseLine(rawLine) as JsonRecord | undefined;
				if (
					line &&
					typeof line.id === "string" &&
					typeof line.thread_name === "string" &&
					line.thread_name.trim()
				) {
					titles.set(line.id, line.thread_name.trim());
				}
			}
		} catch {
			// The index is a convenience; sessions still import without it.
		}
		return titles;
	}

	private sessionFiles(): string[] {
		if (!this.isInstalled()) return [];
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
				} else if (
					entry.isFile() &&
					entry.name.startsWith("rollout-") &&
					entry.name.endsWith(".jsonl")
				) {
					files.push(full);
				}
			}
		};
		walk(this.sessionsDir);
		return files;
	}

	/**
	 * Resuming a Codex thread writes a new rollout file that re-embeds the
	 * original session_meta id, so one logical session can span several files.
	 * Prefer the file with the most conversation (the resumed rollout replays
	 * history), tie-breaking on the most recent activity.
	 */
	private static pickRicherFile(
		a: { meta: CodexFileMeta },
		b: { meta: CodexFileMeta },
	): boolean {
		const userCount = (meta: CodexFileMeta) =>
			meta.userMessageCount || meta.fallbackUserCount;
		if (userCount(b.meta) !== userCount(a.meta)) {
			return userCount(b.meta) > userCount(a.meta);
		}
		return (b.meta.endedAtMs ?? 0) > (a.meta.endedAtMs ?? 0);
	}

	/**
	 * Session id → richest rollout file. Building it means reading every
	 * rollout once (resumed rollouts only carry the original id inside
	 * session_meta, not in their filename), so it is cached for the batch:
	 * without the cache, importing N sessions re-read the whole store N times.
	 */
	private index?: Map<string, { file: string; meta: CodexFileMeta }>;

	private buildIndex(): Map<string, { file: string; meta: CodexFileMeta }> {
		if (this.index) return this.index;
		const best = new Map<string, { file: string; meta: CodexFileMeta }>();
		for (const file of this.sessionFiles()) {
			try {
				const meta = scanFileMeta(readFileSync(file, "utf8"));
				const userCount = meta.userMessageCount || meta.fallbackUserCount;
				if (!meta.sessionId || userCount === 0) continue;
				const candidate = { file, meta };
				const current = best.get(meta.sessionId);
				if (!current || CodexImportAdapter.pickRicherFile(current, candidate)) {
					best.set(meta.sessionId, candidate);
				}
			} catch {
				// A single corrupt rollout never blocks discovery.
			}
		}
		this.index = best;
		return best;
	}

	dispose(): void {
		this.index = undefined;
	}

	private findSessionFile(sourceId: string): string | undefined {
		return this.buildIndex().get(sourceId)?.file;
	}

	discover(): ImportableSessionSummary[] {
		const titles = this.readTitleIndex();
		const out: ImportableSessionSummary[] = [];
		for (const [sessionId, { file, meta }] of this.buildIndex()) {
			const userCount = meta.userMessageCount || meta.fallbackUserCount;
			const preview = truncateForDisplay(meta.firstUserText);
			out.push({
				tool: this.tool,
				sourceId: sessionId,
				sourcePath: file,
				title:
					titles.get(sessionId) ??
					truncateForDisplay(meta.firstUserText, 120) ??
					"Untitled session",
				cwd: meta.cwd,
				startedAtMs: meta.startedAtMs ?? Date.now(),
				updatedAtMs: meta.endedAtMs ?? meta.startedAtMs ?? Date.now(),
				messageCount: userCount + meta.assistantEventCount,
				...(preview ? { preview } : {}),
			});
		}
		return out;
	}

	convert(sourceId: string): ConvertedImportedSession {
		const file = this.findSessionFile(sourceId);
		if (!file) {
			throw new Error(`Codex session ${sourceId} not found`);
		}
		const raw = readFileSync(file, "utf8");
		const meta = scanFileMeta(raw);
		const titles = this.readTitleIndex();

		const messages: LlmsProviders.MessageWithMetadata[] = [];
		const toolNames = new Map<string, string>();
		let assistantBlocks: LlmsProviders.ContentBlock[] = [];
		let pendingToolResults: LlmsProviders.ToolResultContent[] = [];
		let currentModel = meta.model;
		let assistantTs: number | undefined;
		let pendingMetrics:
			| NonNullable<LlmsProviders.MessageWithMetadata["metrics"]>
			| undefined;

		const flushToolResults = () => {
			if (pendingToolResults.length === 0) return;
			messages.push({ role: "user", content: pendingToolResults });
			pendingToolResults = [];
		};
		const flushAssistant = () => {
			if (assistantBlocks.length === 0) return;
			messages.push({
				role: "assistant",
				content: assistantBlocks,
				...(currentModel
					? { modelInfo: { id: currentModel, provider: "openai-native" } }
					: {}),
				...(pendingMetrics ? { metrics: pendingMetrics } : {}),
				...(assistantTs ? { ts: assistantTs } : {}),
			});
			assistantBlocks = [];
			assistantTs = undefined;
			pendingMetrics = undefined;
		};

		for (const rawLine of raw.split("\n")) {
			const line = parseLine(rawLine);
			if (!line?.payload) continue;
			const payload = line.payload;
			const ts = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;

			if (line.type === "turn_context") {
				if (typeof payload.model === "string") currentModel = payload.model;
				continue;
			}

			if (line.type === "event_msg") {
				if (payload.type === "user_message") {
					const text =
						typeof payload.message === "string" ? payload.message : "";
					if (!text.trim()) continue;
					flushAssistant();
					flushToolResults();
					messages.push({
						role: "user",
						content: [{ type: "text", text }],
						...(Number.isFinite(ts) ? { ts } : {}),
					});
				} else if (payload.type === "token_count") {
					// Stamp the latest per-turn usage on the most recent assistant
					// message — which may still be accumulating in assistantBlocks.
					const info = isRecord(payload.info) ? payload.info : undefined;
					const usage = isRecord(info?.last_token_usage)
						? info.last_token_usage
						: undefined;
					if (usage) {
						const metrics = {
							inputTokens: Number(usage.input_tokens) || 0,
							outputTokens: Number(usage.output_tokens) || 0,
							cacheReadTokens: Number(usage.cached_input_tokens) || 0,
							cacheWriteTokens: 0,
							cost: 0,
						};
						if (assistantBlocks.length > 0) {
							pendingMetrics = metrics;
						} else {
							const target = [...messages]
								.reverse()
								.find((message) => message.role === "assistant");
							if (target) target.metrics = metrics;
						}
					}
				}
				continue;
			}

			if (line.type === "compacted") {
				const summary =
					typeof payload.message === "string" ? payload.message : undefined;
				if (summary?.trim()) {
					flushAssistant();
					flushToolResults();
					messages.push({
						role: "user",
						content: [
							{
								type: "text",
								text: `[Conversation summarized by Codex]\n${summary}`,
							},
						],
					});
				}
				continue;
			}

			if (line.type !== "response_item") continue;

			switch (payload.type) {
				case "message": {
					if (payload.role === "user") {
						// User-role response items are mostly AGENTS.md /
						// environment context Codex injects; real prompts arrive
						// as user_message events. Only fall back to them when
						// this rollout has no user_message events at all.
						if (meta.userMessageCount > 0) break;
						const text = messageText(payload);
						if (!text.trim() || isInjectedUserContext(text)) break;
						flushAssistant();
						flushToolResults();
						messages.push({
							role: "user",
							content: [{ type: "text", text }],
							...(Number.isFinite(ts) ? { ts } : {}),
						});
						break;
					}
					if (payload.role !== "assistant") break;
					const text = messageText(payload);
					if (!text.trim()) break;
					flushToolResults();
					assistantBlocks.push({ type: "text", text });
					if (Number.isFinite(ts)) assistantTs = assistantTs ?? ts;
					break;
				}
				case "reasoning": {
					const summary = Array.isArray(payload.summary) ? payload.summary : [];
					const text = summary
						.filter(isRecord)
						.map((item) => (typeof item.text === "string" ? item.text : ""))
						.filter((item) => item.trim().length > 0)
						.join("\n");
					if (!text) break;
					flushToolResults();
					assistantBlocks.push({ type: "thinking", thinking: text });
					if (Number.isFinite(ts)) assistantTs = assistantTs ?? ts;
					break;
				}
				case "function_call":
				case "custom_tool_call": {
					const name = typeof payload.name === "string" ? payload.name : "tool";
					const callId =
						typeof payload.call_id === "string"
							? payload.call_id
							: `import_${nanoid()}`;
					let input: Record<string, unknown> = {};
					if (typeof payload.arguments === "string") {
						try {
							const parsed = JSON.parse(payload.arguments) as unknown;
							input = isRecord(parsed) ? parsed : { arguments: parsed };
						} catch {
							input = { arguments: payload.arguments };
						}
					} else if (typeof payload.input === "string") {
						input = { input: payload.input };
					} else if (isRecord(payload.input)) {
						input = payload.input;
					}
					toolNames.set(callId, name);
					flushToolResults();
					assistantBlocks.push({ type: "tool_use", id: callId, name, input });
					if (Number.isFinite(ts)) assistantTs = assistantTs ?? ts;
					break;
				}
				case "function_call_output":
				case "custom_tool_call_output": {
					const callId =
						typeof payload.call_id === "string" ? payload.call_id : undefined;
					if (!callId) break;
					const output = toolOutputText(payload.output);
					flushAssistant();
					pendingToolResults.push({
						type: "tool_result",
						tool_use_id: callId,
						name: toolNames.get(callId) ?? "",
						content: output,
					});
					break;
				}
				default:
					// web_search_call and friends have no replayable payload; the
					// assistant text already narrates what they did.
					break;
			}
		}
		flushAssistant();
		flushToolResults();

		const prompt = truncateForDisplay(meta.firstUserText, 2000);
		return {
			tool: this.tool,
			sourceId,
			sourcePath: file,
			title:
				titles.get(sourceId) ??
				truncateForDisplay(meta.firstUserText, 120) ??
				"Untitled session",
			...(prompt ? { prompt } : {}),
			provider: "openai-native",
			model: currentModel ?? "gpt-5",
			cwd: meta.cwd,
			...(meta.gitBranch ? { gitBranch: meta.gitBranch } : {}),
			startedAtMs: meta.startedAtMs ?? Date.now(),
			endedAtMs: meta.endedAtMs ?? meta.startedAtMs ?? Date.now(),
			messages,
		};
	}
}
