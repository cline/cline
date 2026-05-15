/**
 * Custom Compaction Runtime Hook Example
 *
 * Demonstrates message compaction through a plugin runtime hook. The hook runs
 * in `beforeModel`, estimates request size, preserves the first user message
 * and recent working context, and replaces older middle history with one
 * summary message before the provider request.
 *
 * Installation:
 *   mkdir -p .cline/plugins
 *   cp examples/hooks/custom-compaction-hook.example.ts .cline/plugins/custom-compaction-hook.ts
 *
 * Usage:
 *   cline -i "Search the codebase for dispatcher usage, then summarize it"
 *
 * Note: for most plugin-owned message rewrites, prefer registerMessageBuilder().
 * This example exists for cases where you specifically need runtime-hook access
 * to the current request and snapshot.
 */

import type { AgentPlugin } from "@cline/core";
import { estimateTokens as estimateTokensFromChars } from "@cline/shared";

type PluginHooks = NonNullable<AgentPlugin["hooks"]>;
type BeforeModelHook = NonNullable<PluginHooks["beforeModel"]>;
type BeforeModelContext = Parameters<BeforeModelHook>[0];
type AgentMessage = BeforeModelContext["request"]["messages"][number];
type AgentMessagePart = AgentMessage["content"][number];

const MAX_INPUT_TOKENS = 120_000;
const COMPACT_AT_RATIO = 0.75;
const PRESERVE_RECENT_TOKENS = 24_000;
const SUMMARY_PREVIEW_CHARS = 800;

function estimateTokens(text: string): number {
	return estimateTokensFromChars(text.length);
}

function preview(text: string, limit = SUMMARY_PREVIEW_CHARS): string {
	const trimmed = text.trim();
	if (trimmed.length <= limit) {
		return trimmed;
	}
	return `${trimmed.slice(0, limit).trim()}\n...[${trimmed.length - limit} more chars summarized]`;
}

function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function serializePart(message: AgentMessage, part: AgentMessagePart): string {
	switch (part.type) {
		case "text":
			return `[${message.role}]: ${part.text}`;
		case "reasoning":
			return `[assistant reasoning]: ${preview(part.text, 300)}`;
		case "image":
			return `[${message.role} image]: ${part.mediaType ?? "unknown"}`;
		case "file":
			return `[${message.role} file ${part.path}]: ${preview(part.content, 500)}`;
		case "tool-call":
			return `[assistant tool call]: ${part.toolName}(${stringifyUnknown(part.input)})`;
		case "tool-result":
			return `[tool result ${part.toolName}]: ${preview(stringifyUnknown(part.output), 500)}`;
	}
}

function serializeMessage(message: AgentMessage): string {
	return message.content.map((part) => serializePart(message, part)).join("\n");
}

function estimateMessageTokens(message: AgentMessage): number {
	return estimateTokens(serializeMessage(message));
}

function isTurnStartMessage(message: AgentMessage): boolean {
	return (
		message.role === "user" &&
		message.content.some((part) => part.type === "text")
	);
}

function findFirstUserIndex(messages: readonly AgentMessage[]): number {
	return messages.findIndex(isTurnStartMessage);
}

function findRecentStartIndex(messages: readonly AgentMessage[]): number {
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

function collectToolNames(messages: readonly AgentMessage[]): string[] {
	const names = new Set<string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === "tool-call" || part.type === "tool-result") {
				names.add(part.toolName);
			}
		}
	}
	return [...names].sort((left, right) => left.localeCompare(right));
}

function collectTouchedFiles(messages: readonly AgentMessage[]): string[] {
	const paths = new Set<string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === "file") {
				paths.add(part.path);
			}
			if (part.type === "tool-call") {
				for (const value of Object.values(
					typeof part.input === "object" && part.input !== null
						? part.input
						: {},
				)) {
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
	compacted: readonly AgentMessage[],
	tokensBefore: number,
): AgentMessage {
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
		id: `hook_compaction_${Date.now()}`,
		role: "user",
		createdAt: Date.now(),
		metadata: {
			kind: "example_hook_compaction_summary",
			tokensBefore,
			messagesCompacted: compacted.length,
		},
		content: [
			{
				type: "text",
				text: `Context summary:

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
			},
		],
	};
}

const plugin: AgentPlugin = {
	name: "custom-compaction-before-model-hook",
	manifest: {
		capabilities: ["hooks"],
	},

	hooks: {
		beforeModel({ request }) {
			const messages = request.messages;
			const totalTokens = messages.reduce(
				(total, message) => total + estimateMessageTokens(message),
				0,
			);
			if (totalTokens < MAX_INPUT_TOKENS * COMPACT_AT_RATIO) {
				return undefined;
			}

			const firstUserIndex = findFirstUserIndex(messages);
			if (firstUserIndex < 0) {
				return undefined;
			}

			const recentStartIndex = Math.max(
				firstUserIndex + 1,
				findRecentStartIndex(messages),
			);
			if (recentStartIndex <= firstUserIndex + 1) {
				return undefined;
			}

			const prefix = messages.slice(0, firstUserIndex + 1);
			const compacted = messages.slice(firstUserIndex + 1, recentStartIndex);
			const recent = messages.slice(recentStartIndex);
			if (compacted.length === 0) {
				return undefined;
			}

			return {
				messages: [
					...prefix,
					buildCompactionSummary(compacted, totalTokens),
					...recent,
				],
			};
		},
	},
};

export { plugin };
export default plugin;
