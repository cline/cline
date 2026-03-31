import type {
	ChatMessage,
	ChatSessionConfig,
	ChatSessionStatus,
} from "@/lib/chat-schema";
import type { SessionHistoryStatus } from "@/lib/session-history";
import { OAUTH_MANAGED_PROVIDERS } from "./constants";

type RpcMessageLike = {
	role?: string;
	content?: unknown;
};

export function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stringifyRpcMessageContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "string") {
				if (block.trim()) {
					parts.push(block);
				}
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			const obj = block as Record<string, unknown>;
			const text = obj.text;
			if (typeof text === "string" && text.trim()) {
				parts.push(text);
			}
		}
		return parts.join("\n");
	}
	if (content && typeof content === "object") {
		const obj = content as Record<string, unknown>;
		const text = obj.text;
		if (typeof text === "string") {
			return text;
		}
	}
	return "";
}

export function extractAssistantTextFromRpcMessages(messages: unknown): string {
	return extractAssistantTurnDataFromRpcMessages(messages).text;
}

export function extractAssistantTurnDataFromRpcMessages(messages: unknown): {
	text: string;
	reasoning: string;
	reasoningRedacted: boolean;
} {
	if (!Array.isArray(messages)) {
		return { text: "", reasoning: "", reasoningRedacted: false };
	}
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as RpcMessageLike;
		if (message?.role !== "assistant") {
			continue;
		}
		const reasoningParts: string[] = [];
		let reasoningRedacted = false;
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!block || typeof block !== "object") {
					continue;
				}
				const obj = block as Record<string, unknown>;
				if (obj.type === "thinking") {
					const thinking =
						typeof obj.thinking === "string" ? obj.thinking.trim() : "";
					if (thinking) {
						reasoningParts.push(thinking);
					}
					continue;
				}
				if (obj.type === "redacted_thinking") {
					reasoningRedacted = true;
				}
			}
		}
		return {
			text: stringifyRpcMessageContent(message.content).trim(),
			reasoning: reasoningParts.join("\n").trim(),
			reasoningRedacted,
		};
	}
	return { text: "", reasoning: "", reasoningRedacted: false };
}

export function buildToolPayloadString(options: {
	toolName: string;
	input: unknown;
	output: unknown;
	error?: string;
}): string {
	const { toolName, input, output, error } = options;
	return JSON.stringify({
		toolName,
		input,
		result: error ? error : output,
		isError: Boolean(error),
	});
}

export function normalizeRuntimeConfig(
	config: ChatSessionConfig,
): ChatSessionConfig {
	const normalizedWorkspaceRoot = config.workspaceRoot.trim();
	const normalizedCwd = (config.cwd?.trim() || normalizedWorkspaceRoot).trim();
	return {
		...config,
		workspaceRoot: normalizedWorkspaceRoot,
		cwd: normalizedCwd || normalizedWorkspaceRoot,
		enableSpawn: false,
		enableTeams: false,
	};
}

export function resolveCredentialError(
	config: ChatSessionConfig,
): string | null {
	const providerId = config.provider.trim().toLowerCase();
	if (!providerId) {
		return "Provider is required before starting a chat session.";
	}
	if (OAUTH_MANAGED_PROVIDERS.has(providerId)) {
		return null;
	}
	if (config.apiKey.trim().length > 0) {
		return null;
	}
	return `Missing API key for provider "${config.provider}". Add credentials in Settings, or switch providers.`;
}

function mapHistoryStatusToChatStatus(
	status: SessionHistoryStatus,
): ChatSessionStatus {
	switch (status) {
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return "idle";
	}
}

export function inferHydratedChatStatus(
	fallback: SessionHistoryStatus,
	messages: ChatMessage[],
): ChatSessionStatus {
	if (fallback === "failed") {
		return "failed";
	}
	if (fallback === "cancelled") {
		return "cancelled";
	}
	const meaningfulMessages = messages.filter((message) => {
		if (message.role !== "user" && message.role !== "assistant") {
			return false;
		}
		return message.content.trim().length > 0;
	});
	if (meaningfulMessages.length === 0) {
		return mapHistoryStatusToChatStatus(fallback);
	}
	if (fallback === "running") {
		const lastMeaningful = meaningfulMessages[meaningfulMessages.length - 1];
		if (lastMeaningful?.role === "assistant") {
			return "completed";
		}
	}
	return mapHistoryStatusToChatStatus(fallback);
}
