import type { AgentConfig, AgentEvent, AgentResult } from "@clinebot/agents";
import type { LlmsProviders } from "@clinebot/llms";
import type { SessionSource } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import { nowIso } from "../session-artifacts";
import type { SessionRowShape } from "../session-service";
import type { StoredMessageWithMetadata } from "./types";

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

export function extractWorkspaceMetadataFromSystemPrompt(
	systemPrompt: string,
): string | undefined {
	const markerIndex = systemPrompt.lastIndexOf(WORKSPACE_CONFIGURATION_MARKER);
	if (markerIndex < 0) {
		return undefined;
	}
	const metadata = systemPrompt.slice(markerIndex).trim();
	return metadata.length > 0 ? metadata : undefined;
}

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

export function toSessionRecord(row: SessionRowShape): SessionRecord {
	const metadata =
		typeof row.metadata_json === "string" && row.metadata_json.trim().length > 0
			? (() => {
					try {
						const parsed = JSON.parse(row.metadata_json) as unknown;
						if (
							parsed &&
							typeof parsed === "object" &&
							!Array.isArray(parsed)
						) {
							return parsed as Record<string, unknown>;
						}
					} catch {
						// Ignore malformed metadata payloads.
					}
					return undefined;
				})()
			: undefined;
	return {
		sessionId: row.session_id,
		source: row.source as SessionSource,
		pid: row.pid,
		startedAt: row.started_at,
		endedAt: row.ended_at ?? null,
		exitCode: row.exit_code ?? null,
		status: row.status,
		interactive: row.interactive === 1,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspace_root,
		teamName: row.team_name ?? undefined,
		enableTools: row.enable_tools === 1,
		enableSpawn: row.enable_spawn === 1,
		enableTeams: row.enable_teams === 1,
		parentSessionId: row.parent_session_id ?? undefined,
		parentAgentId: row.parent_agent_id ?? undefined,
		agentId: row.agent_id ?? undefined,
		conversationId: row.conversation_id ?? undefined,
		isSubagent: row.is_subagent === 1,
		prompt: row.prompt ?? undefined,
		metadata,
		transcriptPath: row.transcript_path,
		hookPath: row.hook_path,
		messagesPath: row.messages_path ?? undefined,
		updatedAt: row.updated_at ?? nowIso(),
	};
}
