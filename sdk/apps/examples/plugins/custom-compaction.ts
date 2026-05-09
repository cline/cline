/**
 * Custom Message Compaction Plugin Example
 *
 * Shows how a plugin can use registerMessageBuilder() to rewrite provider-bound
 * messages before the model call. This example mirrors the shape of core
 * compaction: it estimates context size, preserves the first user message and
 * recent working context, and replaces older middle history with one concise
 * continuation summary message.
 *
 * Core still runs its built-in API-safety message builder after plugin builders,
 * so provider-safe normalization and hard truncation remain the final pass.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp apps/examples/plugins/custom-compaction.ts .cline/plugins/custom-compaction.ts
 *   cline -i "Search the codebase for dispatcher usage, then summarize it"
 */

import type { AgentPlugin, Message, ToolResultContent } from "@clinebot/core";

const CONTEXT_WINDOW_TOKENS = 120_000;
const COMPACT_AT_RATIO = 0.75;
const PRESERVE_RECENT_TOKENS = 24_000;
const SUMMARY_PREVIEW_CHARS = 800;

function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

function preview(text: string, limit = SUMMARY_PREVIEW_CHARS): string {
	if (text.length <= limit) {
		return text.trim();
	}
	return `${text.slice(0, limit).trim()}\n...[${text.length - limit} more chars summarized]`;
}

function stringifyContent(content: ToolResultContent["content"]): string {
	return typeof content === "string" ? content : JSON.stringify(content);
}

function serializeMessage(message: Message): string {
	if (typeof message.content === "string") {
		return `[${message.role}]: ${message.content}`;
	}

	const lines: string[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				lines.push(`[${message.role}]: ${block.text ?? ""}`);
				break;
			case "thinking":
				lines.push(
					`[assistant thinking]: ${preview(block.thinking ?? "", 300)}`,
				);
				break;
			case "tool_use":
				lines.push(
					`[assistant tool call]: ${block.name ?? "tool"}(${JSON.stringify(block.input ?? {})})`,
				);
				break;
			case "tool_result":
				lines.push(
					`[tool result ${block.tool_use_id ?? "unknown"}]: ${preview(stringifyContent(block.content), 500)}`,
				);
				break;
			case "file":
				lines.push(
					`[file ${block.path ?? "unknown"}]: ${preview(String(block.content ?? ""), 500)}`,
				);
				break;
			default:
				lines.push(`[${message.role} ${block.type} block]`);
		}
	}
	return lines.join("\n");
}

function estimateMessageTokens(message: Message): number {
	return estimateTokens(serializeMessage(message));
}

function findFirstUserIndex(messages: Message[]): number {
	return messages.findIndex((message) => message.role === "user");
}

function findRecentStartIndex(messages: Message[]): number {
	let tokens = 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		tokens += estimateMessageTokens(message);
		if (tokens >= PRESERVE_RECENT_TOKENS) {
			return index;
		}
	}
	return 0;
}

function collectToolNames(messages: Message[]): string[] {
	const names = new Set<string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use" && block.name) {
				names.add(block.name);
			}
		}
	}
	return [...names].sort((left, right) => left.localeCompare(right));
}

function collectTouchedFiles(messages: Message[]): string[] {
	const paths = new Set<string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "file" && block.path) {
				paths.add(block.path);
			}
			if (block.type === "tool_use") {
				for (const value of Object.values(block.input ?? {})) {
					if (typeof value === "string" && value.includes("/")) {
						paths.add(value);
					}
				}
			}
		}
	}
	return [...paths].sort((left, right) => left.localeCompare(right));
}

function buildCompactionSummary(
	compacted: Message[],
	tokensBefore: number,
): Message {
	const roleCounts = compacted.reduce<Record<string, number>>(
		(counts, message) => {
			counts[message.role] = (counts[message.role] ?? 0) + 1;
			return counts;
		},
		{},
	);
	const tools = collectToolNames(compacted);
	const files = collectTouchedFiles(compacted);
	const highlights = compacted
		.map(serializeMessage)
		.map((line) => preview(line, 500))
		.slice(-6);

	return {
		role: "user",
		content: `Context summary:

## Compacted Range
- Messages compacted: ${compacted.length}
- Estimated tokens before compaction: ${tokensBefore}
- Roles: ${Object.entries(roleCounts)
			.map(([role, count]) => `${role}=${count}`)
			.join(", ")}

## Tool Activity
${tools.length > 0 ? tools.map((tool) => `- ${tool}`).join("\n") : "- none"}

## Files Mentioned
${files.length > 0 ? files.map((path) => `- ${path}`).join("\n") : "- none"}

## Recent Highlights From Compacted History
${highlights.length > 0 ? highlights.map((item) => `- ${item}`).join("\n") : "- none"}

Continue from this summary plus the preserved recent messages below.`,
	};
}

export const plugin: AgentPlugin = {
	name: "custom-compaction",
	manifest: {
		capabilities: ["messageBuilders"],
	},

	setup(api) {
		api.registerMessageBuilder({
			name: "summarize-middle-history",
			build(messages) {
				const totalTokens = messages.reduce(
					(total, message) => total + estimateMessageTokens(message),
					0,
				);
				if (totalTokens < CONTEXT_WINDOW_TOKENS * COMPACT_AT_RATIO) {
					return messages;
				}

				const firstUserIndex = findFirstUserIndex(messages);
				const recentStartIndex = Math.max(
					firstUserIndex + 1,
					findRecentStartIndex(messages),
				);
				if (firstUserIndex < 0 || recentStartIndex <= firstUserIndex + 1) {
					return messages;
				}

				const prefix = messages.slice(0, firstUserIndex + 1);
				const compacted = messages.slice(firstUserIndex + 1, recentStartIndex);
				const recent = messages.slice(recentStartIndex);
				if (compacted.length === 0) {
					return messages;
				}

				return [
					...prefix,
					buildCompactionSummary(compacted, totalTokens),
					...recent,
				];
			},
		});
	},
};

export default plugin;
