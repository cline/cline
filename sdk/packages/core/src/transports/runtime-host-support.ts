import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type * as LlmsProviders from "@clinebot/llms";
import type { HookEventPayload } from "../hooks";
import type { SessionAccumulatedUsage } from "../runtime/runtime-host";
import type { CoreSessionEvent } from "../types/events";

export class RuntimeHostEventBus {
	private readonly listeners = new Set<(event: CoreSessionEvent) => void>();

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: CoreSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
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
		if (Array.isArray(parsed)) return parsed as LlmsProviders.Message[];
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const messages = (parsed as { messages?: unknown }).messages;
			if (Array.isArray(messages)) return messages as LlmsProviders.Message[];
		}
		return [];
	} catch {
		return [];
	}
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
