import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { formatDisplayUserInput } from "@cline/shared";
import { readSessionManifest } from "../paths";
import type { JsonRecord, SidecarContext } from "../types";
import { readPersistedChatMessages } from "./messages";

export type SessionExportFormat = "html" | "json";

type RawMessage = JsonRecord & {
	role?: unknown;
	content?: unknown;
};

function asRecord(value: unknown): JsonRecord | null {
	return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function renderTextHtml(text: string): string {
	let html = escapeHtml(text);
	html = html.replace(
		/```(\w*)\n([\s\S]*?)```/g,
		(_match, _lang, code: string) => `<pre><code>${code.trim()}</code></pre>`,
	);
	html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/\n/g, "<br>");
	return `<div class="text">${html}</div>`;
}

function stringifyToolPayload(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

function renderToolUseHtml(
	block: JsonRecord,
	result: JsonRecord | undefined,
): string {
	const name = typeof block.name === "string" ? block.name : "tool_call";
	const input = stringifyToolPayload(block.input ?? null);
	const isError = Boolean(result?.is_error);
	const resultText = result
		? stringifyToolPayload(result.content ?? null)
		: "";
	return `
      <details class="tool">
        <summary><span class="tool-name">${escapeHtml(name)}</span>${
					result
						? `<span class="tool-status ${isError ? "error" : "success"}">${isError ? "Error" : "Success"}</span>`
						: ""
				}</summary>
        <div class="tool-body">
          <div class="tool-label">Input</div>
          <pre>${escapeHtml(input)}</pre>
          ${result ? `<div class="tool-label">Result</div><pre>${escapeHtml(resultText)}</pre>` : ""}
        </div>
      </details>`;
}

function collectToolResults(messages: RawMessage[]): Map<string, JsonRecord> {
	const results = new Map<string, JsonRecord>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const item of message.content) {
			const block = asRecord(item);
			if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
				results.set(block.tool_use_id, block);
			}
		}
	}
	return results;
}

function renderMessageBodyHtml(
	message: RawMessage,
	toolResults: Map<string, JsonRecord>,
): string {
	// User turns carry the runtime's <user_input mode="..."> envelope; show
	// what the user actually typed, like the CLI export does.
	const displayText = (text: string) =>
		message.role === "user" ? formatDisplayUserInput(text) : text;
	if (typeof message.content === "string") {
		const text = displayText(message.content);
		return text.trim() ? renderTextHtml(text) : "";
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	const parts: string[] = [];
	for (const item of message.content) {
		const block = asRecord(item);
		if (!block) {
			continue;
		}
		if (block.type === "text" && typeof block.text === "string") {
			const text = displayText(block.text);
			if (text.trim()) {
				parts.push(renderTextHtml(text));
			}
			continue;
		}
		if (block.type === "tool_use") {
			const toolUseId = typeof block.id === "string" ? block.id : "";
			parts.push(renderToolUseHtml(block, toolResults.get(toolUseId)));
			continue;
		}
		if (block.type === "image") {
			const source = asRecord(block.source);
			const mediaType =
				typeof block.mediaType === "string"
					? block.mediaType
					: typeof source?.media_type === "string"
						? source.media_type
						: "";
			const data =
				typeof block.data === "string"
					? block.data
					: typeof source?.data === "string"
						? source.data
						: "";
			if (mediaType && data) {
				parts.push(
					`<img class="attachment" alt="attachment" src="data:${escapeHtml(mediaType)};base64,${escapeHtml(data)}">`,
				);
			}
		}
		// tool_result blocks render with their tool_use; thinking blocks are
		// internal reasoning and stay out of the shared export.
	}
	return parts.join("\n");
}

function messageHasVisibleContent(message: RawMessage): boolean {
	if (message.role === "assistant") {
		return true;
	}
	if (typeof message.content === "string") {
		return message.content.trim().length > 0;
	}
	if (!Array.isArray(message.content)) {
		return false;
	}
	return message.content.some((item) => {
		const block = asRecord(item);
		return (
			block?.type === "text" &&
			typeof block.text === "string" &&
			block.text.trim().length > 0
		);
	});
}

/**
 * Renders a conversation into a fully standalone HTML document, mirroring the
 * CLI's `cline history export` output: no external assets, dark theme, header
 * stats for message count / tokens / cost.
 */
export function generateSessionExportHtml(input: {
	sessionId: string;
	title?: string;
	updatedAt?: string;
	messages: unknown[];
}): string {
	const messages = input.messages.filter(
		(item): item is RawMessage => !!asRecord(item),
	);
	const toolResults = collectToolResults(messages);
	const visible = messages.filter(
		(message) =>
			(message.role === "user" || message.role === "assistant") &&
			messageHasVisibleContent(message),
	);

	let totalCost = 0;
	let totalTokens = 0;
	for (const message of messages) {
		const metrics = asRecord(message.metrics);
		if (!metrics) {
			continue;
		}
		if (typeof metrics.cost === "number") {
			totalCost += metrics.cost;
		}
		if (typeof metrics.inputTokens === "number") {
			totalTokens += metrics.inputTokens;
		}
		if (typeof metrics.outputTokens === "number") {
			totalTokens += metrics.outputTokens;
		}
	}

	const messagesHtml = visible
		.map((message) => {
			const isUser = message.role === "user";
			const modelInfo = asRecord(message.modelInfo);
			const modelId =
				typeof modelInfo?.id === "string" ? modelInfo.id : undefined;
			return `
    <section class="message ${isUser ? "user" : "assistant"}">
      <div class="message-header">
        <span class="avatar ${isUser ? "user" : "assistant"}">${isUser ? "U" : "A"}</span>
        <span class="role">${isUser ? "User" : "Assistant"}</span>
        ${modelId ? `<span class="model">${escapeHtml(modelId)}</span>` : ""}
      </div>
      <div class="body">
        ${renderMessageBodyHtml(message, toolResults)}
      </div>
    </section>`;
		})
		.join("\n");

	const title = input.title?.trim() || `Session ${input.sessionId}`;
	const updatedAt = input.updatedAt
		? new Date(input.updatedAt).toLocaleString()
		: "";
	const stats = [
		`${visible.length} messages`,
		totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens` : "",
		totalCost > 0 ? `$${totalCost.toFixed(4)}` : "",
		updatedAt,
	]
		.filter(Boolean)
		.map((stat) => `<span class="stat">${escapeHtml(stat)}</span>`)
		.join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Conversation Export</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #09090b; color: #fafafa; line-height: 1.6;
    }
    .header {
      position: sticky; top: 0; z-index: 10;
      background: rgba(9, 9, 11, 0.95); backdrop-filter: blur(8px);
      border-bottom: 1px solid #27272a; padding: 1rem 1.5rem;
    }
    .header-content { max-width: 56rem; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem 1.5rem; }
    .header h1 { font-size: 1rem; font-weight: 600; }
    .stat { font-size: 0.8125rem; color: #a1a1aa; }
    .messages { max-width: 56rem; margin: 0 auto; }
    .message { padding: 1.5rem; border-bottom: 1px solid #18181b; }
    .message.user { background: rgba(39, 39, 42, 0.3); }
    .message-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .avatar {
      width: 2rem; height: 2rem; border-radius: 9999px; display: inline-flex;
      align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 500;
    }
    .avatar.user { background: #3b82f6; color: white; }
    .avatar.assistant { background: #27272a; color: #a1a1aa; }
    .role { font-weight: 500; font-size: 0.875rem; }
    .model { font-size: 0.75rem; color: #71717a; font-family: ui-monospace, monospace; }
    .body { padding-left: 2.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .text { overflow-wrap: anywhere; }
    pre {
      background: #18181b; border: 1px solid #27272a; border-radius: 0.5rem;
      padding: 0.75rem 1rem; overflow-x: auto; font-family: ui-monospace, monospace;
      font-size: 0.8125rem; white-space: pre-wrap; word-break: break-word;
    }
    code { font-family: ui-monospace, monospace; background: #27272a; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875em; }
    pre code { background: transparent; padding: 0; }
    .tool { border: 1px solid #27272a; border-radius: 0.5rem; overflow: hidden; }
    .tool summary {
      display: flex; align-items: center; gap: 0.75rem; cursor: pointer;
      padding: 0.625rem 1rem; background: #18181b;
      font-family: ui-monospace, monospace; font-size: 0.8125rem; list-style: none;
    }
    .tool summary::before { content: "\\25B8"; color: #71717a; }
    .tool[open] summary::before { content: "\\25BE"; }
    .tool-status.success { color: #4ade80; font-size: 0.75rem; }
    .tool-status.error { color: #f87171; font-size: 0.75rem; }
    .tool-body { padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .tool-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; }
    .attachment { max-width: 100%; border-radius: 0.5rem; border: 1px solid #27272a; }
    @media (max-width: 768px) { .body { padding-left: 0; } }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <h1>${escapeHtml(title)}</h1>
      ${stats}
    </div>
  </header>
  <main class="messages">
    ${messagesHtml}
  </main>
</body>
</html>`;
}

function sanitizeForFileName(value: string): string {
	const cleaned = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "session";
}

function exportTimestamp(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	);
}

export function resolveExportDirectory(): string {
	const downloads = join(homedir(), "Downloads");
	return existsSync(downloads) ? downloads : tmpdir();
}

/**
 * Writes a standalone export of a session's conversation to disk and returns
 * its path. Prefers the persisted transcript; a session that has not been
 * persisted yet (mid-first-turn) falls back to the live in-memory messages.
 */
export function exportChatSessionToFile(
	ctx: Pick<SidecarContext, "liveSessions">,
	input: {
		sessionId: string;
		format: SessionExportFormat;
		outputDirectory?: string;
	},
): { path: string; format: SessionExportFormat; messageCount: number } {
	const sessionId = input.sessionId.trim();
	if (!sessionId) {
		throw new Error("sessionId is required");
	}
	const persisted = readPersistedChatMessages(sessionId);
	const messages =
		persisted && persisted.length > 0
			? persisted
			: (ctx.liveSessions.get(sessionId)?.messages ?? []);
	if (messages.length === 0) {
		throw new Error("This session has no messages to export yet");
	}

	const manifest = readSessionManifest(sessionId);
	const metadata = asRecord(manifest?.metadata);
	const title = typeof metadata?.title === "string" ? metadata.title : undefined;
	const updatedAt =
		typeof manifest?.updatedAt === "string" ? manifest.updatedAt : undefined;

	const contents =
		input.format === "html"
			? generateSessionExportHtml({ sessionId, title, updatedAt, messages })
			: `${JSON.stringify({ version: 1, sessionId, updated_at: updatedAt, messages }, null, 2)}\n`;

	const directory = input.outputDirectory?.trim() || resolveExportDirectory();
	const fileName = `cline-${sanitizeForFileName(sessionId).slice(0, 40)}-${exportTimestamp(new Date())}.${input.format}`;
	const path = join(directory, fileName);
	mkdirSync(directory, { recursive: true });
	writeFileSync(path, contents, "utf8");
	return { path, format: input.format, messageCount: messages.length };
}
