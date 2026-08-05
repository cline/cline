import { createSessionId } from "@cline/shared/browser";
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
	return createSessionId(`${prefix}_`);
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
	images: Array<{ data: string; mediaType: string }>;
} {
	if (!Array.isArray(messages)) {
		return { text: "", reasoning: "", reasoningRedacted: false, images: [] };
	}
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as RpcMessageLike;
		if (message?.role !== "assistant") {
			continue;
		}
		const reasoningParts: string[] = [];
		const images: Array<{ data: string; mediaType: string }> = [];
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
					continue;
				}
				if (
					obj.type === "image" &&
					typeof obj.data === "string" &&
					typeof obj.mediaType === "string"
				) {
					images.push({ data: obj.data, mediaType: obj.mediaType });
				}
			}
		}
		return {
			text: stringifyRpcMessageContent(message.content).trim(),
			reasoning: reasoningParts.join("\n").trim(),
			reasoningRedacted,
			images,
		};
	}
	return { text: "", reasoning: "", reasoningRedacted: false, images: [] };
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
	const thinking = config.reasoningEffort ? true : config.thinking;
	return {
		...config,
		workspaceRoot: normalizedWorkspaceRoot,
		cwd: normalizedCwd || normalizedWorkspaceRoot,
		thinking,
		reasoningEffort: thinking === false ? undefined : config.reasoningEffort,
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
	_messages: ChatMessage[],
): ChatSessionStatus {
	// The persisted runtime status is authoritative. A running turn can emit an
	// assistant message and then continue into reasoning or tool execution, so
	// transcript shape cannot prove completion. Dead-process rows are reconciled
	// by the session persistence layer before they reach this hydration path.
	return mapHistoryStatusToChatStatus(fallback);
}
