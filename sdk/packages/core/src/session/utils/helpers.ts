import type { AgentConfig, AgentEvent, AgentResult } from "@clinebot/agents";
import type * as LlmsProviders from "@clinebot/llms/providers";
import type { SessionSource } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import type { SessionRow } from "../session-service";
import type { StoredMessageWithMetadata } from "./types";

export function hasRuntimeHooks(hooks: AgentConfig["hooks"]): boolean {
	if (!hooks) {
		return false;
	}
	return Object.values(hooks).some((value) => typeof value === "function");
}

export function mergeAgentExtensions(
	explicitExtensions: AgentConfig["extensions"] | undefined,
	loadedExtensions: AgentConfig["extensions"] | undefined,
): AgentConfig["extensions"] {
	const merged = [...(explicitExtensions ?? []), ...(loadedExtensions ?? [])];
	if (merged.length === 0) {
		return undefined;
	}
	const deduped: NonNullable<AgentConfig["extensions"]> = [];
	const seenNames = new Set<string>();
	for (const extension of merged) {
		if (seenNames.has(extension.name)) {
			continue;
		}
		seenNames.add(extension.name);
		deduped.push(extension);
	}
	return deduped;
}

export function serializeAgentEvent(event: AgentEvent): string {
	return JSON.stringify(event, (_key, value) => {
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				stack: value.stack,
			};
		}
		return value;
	});
}

export function withLatestAssistantTurnMetadata(
	messages: LlmsProviders.Message[],
	result: AgentResult,
	previousMessages: LlmsProviders.MessageWithMetadata[] = [],
): StoredMessageWithMetadata[] {
	const next = messages.map((message, index) => {
		const previous = previousMessages[index];
		const sameMessage =
			previous?.role === message.role &&
			JSON.stringify(previous.content) === JSON.stringify(message.content);
		return sameMessage
			? ({
					...previous,
					...message,
				} as StoredMessageWithMetadata)
			: ({ ...message } as StoredMessageWithMetadata);
	});
	const assistantIndex = [...next]
		.reverse()
		.findIndex((message) => message.role === "assistant");
	if (assistantIndex === -1) {
		return next;
	}

	const targetIndex = next.length - 1 - assistantIndex;
	const target = next[targetIndex];
	const usage = result.usage;
	next[targetIndex] = {
		...target,
		providerId: target.providerId ?? result.model.provider,
		modelId: target.modelId ?? result.model.id,
		modelInfo: target.modelInfo ?? {
			id: result.model.id,
			provider: result.model.provider,
		},
		metrics: {
			...(target.metrics ?? {}),
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			cost: usage.totalCost,
		},
		ts: target.ts ?? result.endedAt.getTime(),
	};
	return next;
}

export function toSessionRecord(row: SessionRow): SessionRecord {
	return {
		sessionId: row.sessionId,
		source: row.source as SessionSource,
		pid: row.pid,
		startedAt: row.startedAt,
		endedAt: row.endedAt ?? null,
		exitCode: row.exitCode ?? null,
		status: row.status,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspaceRoot,
		teamName: row.teamName ?? undefined,
		enableTools: row.enableTools,
		enableSpawn: row.enableSpawn,
		enableTeams: row.enableTeams,
		parentSessionId: row.parentSessionId ?? undefined,
		parentAgentId: row.parentAgentId ?? undefined,
		agentId: row.agentId ?? undefined,
		conversationId: row.conversationId ?? undefined,
		isSubagent: row.isSubagent,
		prompt: row.prompt ?? undefined,
		metadata: row.metadata ?? undefined,
		transcriptPath: row.transcriptPath,
		hookPath: row.hookPath,
		messagesPath: row.messagesPath ?? undefined,
		updatedAt: row.updatedAt,
	};
}
