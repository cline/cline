import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import { kilocodeTasksDirs } from "./paths";
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

function readJson(filePath: string): JsonRecord | undefined {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readJsonArray(filePath: string): JsonRecord[] {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is JsonRecord => isRecord(item))
			: [];
	} catch {
		return [];
	}
}

function asMs(value: unknown): number | undefined {
	const num = Number(value);
	return Number.isFinite(num) && num > 0 ? num : undefined;
}

function blockText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.filter(isRecord)
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.filter((text) => text.trim().length > 0)
		.join("\n");
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

/**
 * Convert one Kilo Code (Roo-Code family) message content field into Cline
 * content blocks. `api_conversation_history.json` stores an array of
 * Anthropic-style blocks (text / tool_use / tool_result) or a plain string.
 */
function convertBlocks(
	content: unknown,
	toolNames: Map<string, string>,
): LlmsProviders.ContentBlock[] {
	if (typeof content === "string") {
		return content.trim() ? [{ type: "text", text: content }] : [];
	}
	if (!Array.isArray(content)) return [];
	const blocks: LlmsProviders.ContentBlock[] = [];
	for (const raw of content) {
		if (!isRecord(raw)) continue;
		const type = typeof raw.type === "string" ? raw.type : "";
		switch (type) {
			case "text":
			case "output_text": {
				const text = blockText(raw.text ?? raw.content);
				if (text.trim()) blocks.push({ type: "text", text });
				break;
			}
			case "thinking":
			case "reasoning": {
				const thinking = blockText(raw.thinking ?? raw.text);
				if (thinking.trim()) blocks.push({ type: "thinking", thinking });
				break;
			}
			case "tool_use": {
				const id =
					typeof raw.id === "string" ? raw.id : `kilocode_${blocks.length}`;
				const name = typeof raw.name === "string" ? raw.name : "tool";
				const input = isRecord(raw.input) ? raw.input : {};
				toolNames.set(id, name);
				blocks.push({ type: "tool_use", id, name, input });
				break;
			}
			case "tool_result": {
				const toolUseId =
					typeof raw.tool_use_id === "string" ? raw.tool_use_id : undefined;
				if (!toolUseId) break;
				blocks.push({
					type: "tool_result",
					tool_use_id: toolUseId,
					name: toolNames.get(toolUseId) ?? "",
					content: toolResultContent(raw.content),
					is_error: raw.is_error === true,
				});
				break;
			}
			default:
				break;
		}
	}
	return blocks;
}

interface KilocodeTask {
	taskId: string;
	dir: string;
	history: JsonRecord[];
	metadata: JsonRecord | undefined;
}

export interface KilocodeAdapterOptions {
	/** Defaults to the VS Code globalStorage tasks directory. */
	tasksDir?: string;
    /** Override for Kilo Code CLI tasks directory. */
    cliTasksDir?: string;
}

export class KilocodeImportAdapter implements SessionImportAdapter {
	readonly tool = "kilocode" as const;
	private readonly tasksDir: string;

    constructor(options: KilocodeAdapterOptions = {}) {
        this.tasksDir = options.tasksDir
            ?? options.cliTasksDir
            ?? kilocodeTasksDirs().find((d) => existsSync(d)) ?? kilocodeTasksDirs()[0];
    }

	isInstalled(): boolean {
		return existsSync(this.tasksDir);
	}

	private listTasks(): KilocodeTask[] {
		if (!this.isInstalled()) return [];
		const tasks: KilocodeTask[] = [];
		for (const entry of readdirSync(this.tasksDir)) {
			const dir = join(this.tasksDir, entry);
			try {
				if (!statSync(dir).isDirectory()) continue;
			} catch {
				continue;
			}
			const history = readJsonArray(join(dir, "api_conversation_history.json"));
			if (history.length === 0) continue;
			tasks.push({
				taskId: entry,
				dir,
				history,
				metadata: readJson(join(dir, "task_metadata.json")),
			});
		}
		return tasks;
	}

	private cwdFromMetadata(metadata: JsonRecord | undefined): string {
		const cwd = metadata?.cwd;
		return typeof cwd === "string" ? cwd : "";
	}

	private mtimeMs(dir: string): number | undefined {
		try {
			return asMs(statSync(dir).mtimeMs);
		} catch {
			return undefined;
		}
	}

	discover(): ImportableSessionSummary[] {
		const out: ImportableSessionSummary[] = [];
		for (const task of this.listTasks()) {
			const toolNames = new Map<string, string>();
			let messageCount = 0;
			let prompt: string | undefined;
			let startedAtMs: number | undefined;
			let updatedAtMs: number | undefined;
			for (const message of task.history) {
				const role = message.role === "assistant" ? "assistant" : "user";
				const blocks = convertBlocks(message.content, toolNames);
				if (blocks.length === 0) continue;
				messageCount += 1;
				const ts = asMs(message.ts);
				if (ts) {
					startedAtMs = startedAtMs ?? ts;
					updatedAtMs = ts;
				}
				if (role === "user" && !prompt) {
					const text = blocks.find((block) => block.type === "text");
					if (text?.type === "text") prompt = text.text;
				}
			}
			if (messageCount === 0) continue;
			const fallbackTitle = `Kilo Code task ${task.taskId.slice(0, 8)}`;
			const started = startedAtMs ?? this.mtimeMs(task.dir) ?? Date.now();
			out.push({
				tool: this.tool,
				sourceId: task.taskId,
				sourcePath: join(task.dir, "api_conversation_history.json"),
				title: truncateForDisplay(prompt, 120) ?? fallbackTitle,
				cwd: this.cwdFromMetadata(task.metadata),
				startedAtMs: started,
				updatedAtMs: updatedAtMs ?? started,
				messageCount,
				...(truncateForDisplay(prompt)
					? { preview: truncateForDisplay(prompt) }
					: {}),
			});
		}
		return out;
	}

	convert(sourceId: string): ConvertedImportedSession {
		const task = this.listTasks().find(
			(candidate) => candidate.taskId === sourceId,
		);
		if (!task) {
			throw new Error(`kilocode task ${sourceId} not found`);
		}

		const toolNames = new Map<string, string>();
		const messages: LlmsProviders.MessageWithMetadata[] = [];
		let model: string | undefined;
		let prompt: string | undefined;
		let firstTs: number | undefined;
		let lastTs: number | undefined;

		for (const message of task.history) {
			const role = message.role === "assistant" ? "assistant" : "user";
			const blocks = convertBlocks(message.content, toolNames);
			if (blocks.length === 0) continue;
			const ts = asMs(message.ts);
			if (ts) {
				firstTs = firstTs ?? ts;
				lastTs = ts;
			}
			if (role === "user" && !prompt) {
				const text = blocks.find((block) => block.type === "text");
				if (text?.type === "text") prompt = text.text;
			}
			messages.push({ role, content: blocks, ...(ts ? { ts } : {}) });
		}

		if (typeof task.metadata?.model === "string" && task.metadata.model) {
			model = task.metadata.model;
		}

		const started = firstTs ?? this.mtimeMs(task.dir) ?? Date.now();
		return {
			tool: this.tool,
			sourceId: task.taskId,
			sourcePath: join(task.dir, "api_conversation_history.json"),
			title:
				truncateForDisplay(prompt, 120) ??
				`Kilo Code task ${task.taskId.slice(0, 8)}`,
			...(truncateForDisplay(prompt, 2000)
				? { prompt: truncateForDisplay(prompt, 2000) }
				: {}),
			// Kilo Code runs on whatever provider the user configured; the resume
			// target stays on the app default (see service.ts), so the source
			// provider here is only a marker in metadata.importedFrom.
			provider: "cline",
			model: model ?? "default",
			cwd: this.cwdFromMetadata(task.metadata),
			startedAtMs: started,
			endedAtMs: lastTs ?? started,
			messages,
		};
	}
}

