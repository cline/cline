import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type * as LlmsProviders from "@cline/llms";
import { formatDisplayUserInput } from "@cline/shared";
import type { HookEventPayload } from "../../hooks";
import type { CoreSessionEvent } from "../../types/events";
import type {
	RuntimeHostSubscribeOptions,
	SessionAccumulatedUsage,
} from "./runtime-host";

export class RuntimeHostEventBus {
	private readonly listeners = new Set<{
		listener: (event: CoreSessionEvent) => void;
		sessionId?: string;
	}>();

	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void {
		const entry = {
			listener,
			sessionId: options?.sessionId?.trim() || undefined,
		};
		this.listeners.add(entry);
		return () => {
			this.listeners.delete(entry);
		};
	}

	emit(event: CoreSessionEvent): void {
		const sessionId = event.payload.sessionId?.trim();
		for (const entry of this.listeners) {
			if (entry.sessionId && entry.sessionId !== sessionId) {
				continue;
			}
			entry.listener(event);
		}
	}

	get size(): number {
		return this.listeners.size;
	}
}

export async function readPersistedMessagesFile(
	messagesPath?: string | null,
): Promise<LlmsProviders.Message[]> {
	const path = messagesPath?.trim();
	if (!path || !existsSync(path)) return [];
	try {
		const raw = (await readFile(path, "utf8")).trim();
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) {
			return sanitizeDisplayMessages(parsed as LlmsProviders.Message[]);
		}
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const messages = (parsed as { messages?: unknown }).messages;
			if (Array.isArray(messages)) {
				return sanitizeDisplayMessages(messages as LlmsProviders.Message[]);
			}
		}
		return [];
	} catch {
		return [];
	}
}

function sanitizeDisplayMessage(
	message: LlmsProviders.Message,
): LlmsProviders.Message {
	if (message.role !== "user") {
		return message;
	}
	if (typeof message.content === "string") {
		return {
			...message,
			content: formatDisplayUserInput(message.content),
		};
	}
	return {
		...message,
		content: message.content.map((part) => {
			if (part.type !== "text" || typeof part.text !== "string") {
				return part;
			}
			return {
				...part,
				text: formatDisplayUserInput(part.text),
			};
		}),
	};
}

function sanitizeDisplayMessages(
	messages: LlmsProviders.Message[],
): LlmsProviders.Message[] {
	return messages.map(sanitizeDisplayMessage);
}

export function cloneAccumulatedUsage(
	usage: SessionAccumulatedUsage | undefined,
): SessionAccumulatedUsage | undefined {
	return usage ? { ...usage } : undefined;
}

type HookAuditBackend = {
	queueSpawnRequest(payload: HookEventPayload): Promise<void>;
	upsertSubagentSessionFromHook(
		payload: HookEventPayload,
	): Promise<string | undefined>;
	appendSubagentHookAudit(
		sessionId: string,
		payload: HookEventPayload,
	): Promise<void>;
	applySubagentStatus(
		sessionId: string,
		payload: HookEventPayload,
	): Promise<void>;
};

export async function replaySubagentHookEvent(
	payload: HookEventPayload,
	backend: HookAuditBackend,
): Promise<void> {
	const shouldTouchSessions =
		payload.hookName === "tool_call" || !!payload.parent_agent_id;
	if (!shouldTouchSessions) {
		return;
	}
	await backend.queueSpawnRequest(payload);
	const subSessionId = await backend.upsertSubagentSessionFromHook(payload);
	if (!subSessionId) {
		return;
	}
	await backend.appendSubagentHookAudit(subSessionId, payload);
	await backend.applySubagentStatus(subSessionId, payload);
}
