import { existsSync } from "node:fs";
import { readSessionMessagesFile } from "../../services/session-messages-jsonl";
import type * as LlmsProviders from "@cline/llms";
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

// Returns the persisted messages verbatim. User messages keep their
// runtime-generated <user_input mode="..."> wrappers and <mode_notice>
// elements: they are the durable record of which mode each message was sent
// in, and session restarts re-seed new sessions through this read path, so
// stripping here would launder that history off disk (and out of the model's
// context) a little more on every restart. Display surfaces are responsible
// for their own formatting via formatDisplayUserInput.
//
// V18 — messages are persisted as JSON Lines (a header row + one message row
// per line) so un-appended rows are O(1) to write and reads stream line-by-line
// with flat memory even for 50MB+ conversations. `readSessionMessagesFile`
// auto-detects the JSONL format (first row has a `header` key); legacy
// pretty-printed JSON files still load via the built-in fallback.
export async function readPersistedMessagesFile(
	messagesPath?: string | null,
	options?: { limit?: number },
): Promise<LlmsProviders.Message[]> {
	const path = messagesPath?.trim();
	if (!path || !existsSync(path)) return [];
	// Full read by default. Consumers depend on the COMPLETE conversation:
	//   - getStateToPostToWebview computes isTruncated/totalMessageCount from
	//     the full list (a default tail window would silently disable
	//     scroll-up pagination: 50 > 50 === false).
	//   - loadHistoryBatch needs the full list to locate messages before a
	//     given ts (a truncated read makes beforeIndex === -1 forever, so
	//     older rows — including api_req_started usage rows — become
	//     unreachable and session billing shows $0.00).
	//   - compaction must summarize the whole transcript, not just the tail.
	// Callers that genuinely only need recent rows pass an explicit limit.
	const messages = await readSessionMessagesFile(path, {
		...(options?.limit !== undefined ? { limit: options.limit } : { startFromEnd: false }),
	});
	return messages as unknown as LlmsProviders.Message[];
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
