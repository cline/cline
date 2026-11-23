/*!
 * Vendored from dify-ai-provider v1.1.1 (https://github.com/warmwind/dify-ai-provider,
 * commit 352943be697b89cf1a4d329e11b53c1f19e4286d), (c) 2024 Oscar Jiang, MIT
 * license (see ./LICENSE). Changes for @ai-sdk/provider-utils 5 and zod 4 are
 * listed in ./README.md.
 */
import type {
	LanguageModelV2CallOptions,
	LanguageModelV2FunctionTool,
} from "@ai-sdk/provider";
import type { Logger } from "./dify-chat-settings";

// ── Think Tag Parser ──

export type ThinkSegment = { type: "reasoning" | "text"; content: string };

export class ThinkTagParser {
	private state: "text" | "maybe-open" | "reasoning" | "maybe-close" = "text";
	private buffer = "";
	private accumulated = "";
	private hasStarted = false;
	private closed = false; // Once </think> is seen, treat all subsequent <think> as plain text
	private textAccumulated = "";
	private inString = false;
	private escape = false;

	feed(chunk: string): ThinkSegment[] {
		const raw: ThinkSegment[] = [];
		this.accumulated += chunk;

		for (let i = 0; i < chunk.length; i++) {
			const ch = chunk[i];

			if (!this.hasStarted) {
				if (ch.trim() === "") continue;
				this.hasStarted = true;
			}

			if (this.inString) {
				if (this.escape) {
					this.escape = false;
					raw.push({ type: "text", content: ch });
				} else if (ch === "\\") {
					this.escape = true;
					raw.push({ type: "text", content: ch });
				} else if (ch === '"') {
					this.inString = false;
					raw.push({ type: "text", content: ch });
				} else {
					raw.push({ type: "text", content: ch });
				}
				continue;
			}

			if (ch === '"') {
				this.inString = true;
				raw.push({ type: "text", content: ch });
				continue;
			}

			switch (this.state) {
				case "text":
					if (ch === "<" && !this.closed) {
						this.state = "maybe-open";
						this.buffer = "<";
					} else {
						raw.push({ type: "text", content: ch });
					}
					break;

				case "maybe-open":
					this.buffer += ch;
					if ("<think>".startsWith(this.buffer)) {
						if (this.buffer === "<think>") {
							this.state = "reasoning";
							this.buffer = "";
						}
					} else {
						raw.push({ type: "text", content: this.buffer });
						this.buffer = "";
						this.state = "text";
					}
					break;

				case "reasoning":
					if (ch === "<") {
						this.state = "maybe-close";
						this.buffer = "<";
					} else {
						raw.push({ type: "reasoning", content: ch });
					}
					break;

				case "maybe-close":
					this.buffer += ch;
					if ("</think>".startsWith(this.buffer)) {
						if (this.buffer === "</think>") {
							this.state = "text";
							this.buffer = "";
							this.closed = true;
						}
					} else {
						raw.push({ type: "reasoning", content: this.buffer });
						this.buffer = "";
						this.state = "reasoning";
					}
					break;
			}
		}

		// Merge consecutive same-type segments
		const merged: ThinkSegment[] = [];
		for (const seg of raw) {
			const last = merged[merged.length - 1];
			if (last && last.type === seg.type) {
				last.content += seg.content;
			} else {
				merged.push({ ...seg });
			}
		}

		// 实时累积解析后的纯文本
		for (const seg of merged) {
			if (seg.type === "text") {
				this.textAccumulated += seg.content;
			}
		}

		return merged;
	}

	flush(): ThinkSegment[] {
		if (!this.buffer) return [];
		const type = this.state === "maybe-close" ? "reasoning" : "text";
		const seg = [{ type, content: this.buffer } as ThinkSegment];
		if (type === "text") {
			this.textAccumulated += this.buffer;
		}
		this.buffer = "";
		return seg;
	}

	reset(text: string): void {
		this.accumulated = "";
		this.buffer = "";
		this.state = "text";
		this.closed = false;
		this.hasStarted = false;
		this.inString = false;
		this.escape = false;
		this.feed(text);
	}

	getTextWithoutThink(): string {
		return this.textAccumulated.trim();
	}
}

// ── Tool Call Parser ──

export interface ParsedToolCall {
	id: string;
	name: string;
	input: string;
}

export function parseToolCalls(
	text: string,
	toolNames: string[],
	genId: () => string,
): { toolCalls: ParsedToolCall[]; cleanText: string } {
	const toolCalls: ParsedToolCall[] = [];
	let cleanText = text;

	if (!toolNames.length) return { toolCalls, cleanText };

	const lowerToolNames = toolNames.map((n) => n.toLowerCase());
	const matchedBlocks: string[] = [];

	let depth = 0;
	let inString = false;
	let escaped = false;
	let startIdx = -1;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;

		if (ch === "{") {
			if (depth === 0) startIdx = i;
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth < 0) depth = 0;
			if (depth === 0 && startIdx !== -1) {
				const jsonCandidate = text.substring(startIdx, i + 1);

				try {
					const parsed = JSON.parse(jsonCandidate);
					if (
						parsed &&
						typeof parsed === "object" &&
						"name" in parsed &&
						"arguments" in parsed
					) {
						const toolName = String(parsed.name).toLowerCase();
						const originalIdx = lowerToolNames.indexOf(toolName);
						if (originalIdx !== -1) {
							toolCalls.push({
								id: genId(),
								name: toolNames[originalIdx],
								input: JSON.stringify(parsed.arguments),
							});
							matchedBlocks.push(jsonCandidate);
						}
					}
				} catch (e) {
					// Not valid JSON, ignore
				}
				startIdx = -1;
			}
		}
	}

	for (const block of matchedBlocks) {
		cleanText = cleanText.replace(block, "");
	}

	return { toolCalls, cleanText: cleanText.trim() };
}

// ── Tool Prompt Formatting ──

interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	required?: string[];
}

function placeholder(schema: JsonSchema | undefined): string {
	if (!schema) return '"..."';
	const t = schema.type;
	if (t === "array") {
		const item = schema.items ? placeholder(schema.items) : '"..."';
		return `[${item}]`;
	}
	if (t === "object") {
		const props = schema.properties;
		if (!props) return "{}";
		const entries = Object.entries(props)
			.slice(0, 3)
			.map(([k, v]) => `"${k}": ${placeholder(v)}`);
		return `{${entries.join(", ")}}`;
	}
	if (t === "number" || t === "integer") return "0";
	if (t === "boolean") return "true";
	return '"..."';
}

const TOOL_SHORT_DESCRIPTIONS: Record<string, string> = {
	question: "Ask the user a question",
	bash: "Execute a bash command",
	read: "Read a file",
	glob: "Find files by pattern",
	grep: "Search file contents with regex",
	edit: "Edit a file with string replacement",
	write: "Write/create a file",
	task: "Launch a sub-agent for complex tasks",
	webfetch: "Fetch content from a URL",
	todowrite: "Create/manage a task list",
	skill: "Load a specialized skill",
};

function getShortDescription(name: string, description?: string): string {
	if (TOOL_SHORT_DESCRIPTIONS[name]) return TOOL_SHORT_DESCRIPTIONS[name];
	if (!description) return name;
	return description
		.replace(/[\r\n]+/g, " ")
		.split(/[.!?。]/)[0]
		.trim()
		.substring(0, 60);
}

export function formatToolsPrompt(tools: LanguageModelV2CallOptions["tools"]): {
	prompt: string;
	toolNames: string[];
} {
	if (!tools?.length) {
		return { prompt: "", toolNames: [] };
	}

	const defs = tools
		.filter((t): t is LanguageModelV2FunctionTool => t.type === "function")
		.map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.inputSchema,
		}));

	if (!defs.length) return { prompt: "", toolNames: [] };

	const toolNames = defs.map((d) => d.name);

	const toolDescriptions = defs.map((t) => {
		const params = t.parameters as JsonSchema | undefined;
		const paramList = params?.properties
			? Object.entries(params.properties)
					.map(([k, v]) => `"${k}": ${placeholder(v)}`)
					.join(", ")
			: "";
		const shortDesc = getShortDescription(t.name, t.description);
		return `- ${t.name}: ${shortDesc}\n  {"name": "${t.name}", "arguments": {${paramList}}}`;
	});

	const prompt = `\n\n# Tools\nCall tools with JSON format:\n\n${toolDescriptions.join("\n")}`;

	return { prompt, toolNames };
}

// ── File Upload ──

export interface DifyFileAttachment {
	type: string;
	transfer_method: string;
	upload_file_id: string;
}

export async function uploadFileToDify(
	data: string | Uint8Array | Buffer,
	mimeType: string,
	filename: string,
	user: string,
	baseURL: string,
	headers: () => Record<string, string>,
	logger?: Logger,
): Promise<string | undefined> {
	try {
		let blob: Blob;
		if (typeof data === "string") {
			const buffer = Buffer.from(data, "base64");
			blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
		} else {
			blob = new Blob([new Uint8Array(data)], { type: mimeType });
		}
		const form = new FormData();
		form.append("file", blob, filename);
		form.append("user", user);

		const { "content-type": _, "Content-Type": __, ...authHeaders } = headers();
		const res = await fetch(`${baseURL}/files/upload`, {
			method: "POST",
			headers: { ...authHeaders },
			body: form,
		});

		if (!res.ok) {
			const errBody = await res.text().catch(() => "");
			logger?.error("Dify file upload failed", {
				status: res.status,
				statusText: res.statusText,
				body: errBody,
			});
			return undefined;
		}

		const json = (await res.json()) as { id?: string };
		return json.id;
	} catch (e) {
		logger?.error("Dify file upload error", { error: String(e) });
		return undefined;
	}
}

export async function extractFileAttachments(
	messages: any[],
	userId: string,
	baseURL: string,
	headers: () => Record<string, string>,
	logger?: Logger,
): Promise<DifyFileAttachment[]> {
	const uploadPromises: Promise<DifyFileAttachment | undefined>[] = [];

	for (const msg of messages) {
		if (!Array.isArray(msg.content)) continue;
		for (const part of msg.content as any[]) {
			if (!part || typeof part !== "object" || part.type !== "file") continue;
			const mimeType: string = part.mediaType || part.mimeType || "";
			if (!mimeType) continue;

			let uploadData: string | Uint8Array | undefined;
			const filename =
				part.filename || `file.${mimeType.split("/")[1] || "bin"}`;

			if (typeof part.data === "string") {
				const m = part.data.match(/^data:[^;]+;base64,(.+)$/);
				uploadData = m ? m[1] : part.data;
			} else if (part.data instanceof Uint8Array) {
				uploadData = part.data;
			}

			if (uploadData) {
				const task = uploadFileToDify(
					uploadData,
					mimeType,
					filename,
					userId,
					baseURL,
					headers,
					logger,
				).then((uploadId): DifyFileAttachment | undefined => {
					if (uploadId) {
						return {
							type: mimeType.startsWith("image/") ? "image" : "document",
							transfer_method: "local_file",
							upload_file_id: uploadId,
						};
					} else {
						logger?.warn(
							"Dify file upload skipped, attachment will be missing",
							{ filename, mimeType },
						);
						return undefined;
					}
				});
				uploadPromises.push(task);
			}
		}
	}

	const results = await Promise.all(uploadPromises);
	return results.filter(
		(item): item is DifyFileAttachment => item !== undefined,
	);
}
