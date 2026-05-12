import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { AgentConfig, AgentEvent, AgentResult } from "@cline/shared";
import { normalizeUserInput } from "@cline/shared";
import { nanoid } from "nanoid";
import {
	parseSubSessionId,
	parseTeamTaskSubSessionId,
} from "../session/models/session-graph";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../session/models/session-manifest";
import type { SessionRow } from "../session/models/session-row";
import type { SessionSource, SessionStatus } from "../types/common";
import type { StoredMessageWithMetadata } from "../types/session";
import type { SessionRecord } from "../types/sessions";

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

function trimNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStoredMessageModelMetadata(
	message: StoredMessageWithMetadata,
	fallback?: {
		id?: string;
		provider?: string;
		family?: string;
	},
): StoredMessageWithMetadata {
	const next = {
		...(message as StoredMessageWithMetadata & {
			providerId?: string;
			modelId?: string;
		}),
	};
	next.id = trimNonEmptyString(next.id) ?? nanoid();
	const modelInfo =
		next.modelInfo && typeof next.modelInfo === "object"
			? { ...next.modelInfo }
			: undefined;
	const resolvedModelInfo = {
		id:
			trimNonEmptyString(modelInfo?.id) ??
			trimNonEmptyString(next.modelId) ??
			trimNonEmptyString(fallback?.id),
		provider:
			trimNonEmptyString(modelInfo?.provider) ??
			trimNonEmptyString(next.providerId) ??
			trimNonEmptyString(fallback?.provider),
		family:
			trimNonEmptyString(modelInfo?.family) ??
			trimNonEmptyString(fallback?.family),
	};

	delete next.providerId;
	delete next.modelId;

	if (resolvedModelInfo.id && resolvedModelInfo.provider) {
		next.modelInfo = {
			id: resolvedModelInfo.id,
			provider: resolvedModelInfo.provider,
			...(resolvedModelInfo.family ? { family: resolvedModelInfo.family } : {}),
		};
	} else {
		delete next.modelInfo;
	}

	return next;
}

export function normalizeStoredMessagesForPersistence(
	messages: LlmsProviders.MessageWithMetadata[],
): StoredMessageWithMetadata[] {
	return messages.map((message) =>
		normalizeStoredMessageModelMetadata(message as StoredMessageWithMetadata),
	);
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
		const merged = sameMessage
			? ({
					...previous,
					...message,
				} as StoredMessageWithMetadata)
			: ({ ...message } as StoredMessageWithMetadata);
		return normalizeStoredMessageModelMetadata(merged);
	});
	const firstNewMessageIndex = previousMessages.length;
	const assistantIndexes: number[] = [];
	for (let index = firstNewMessageIndex; index < next.length; index += 1) {
		if (next[index]?.role === "assistant") {
			assistantIndexes.push(index);
		}
	}
	if (assistantIndexes.length === 0) {
		const lastAssistantIndex = [...next]
			.reverse()
			.findIndex((message) => message.role === "assistant");
		if (lastAssistantIndex === -1) {
			return next;
		}
		assistantIndexes.push(next.length - 1 - lastAssistantIndex);
	}

	const lastAssistantIndex = assistantIndexes[assistantIndexes.length - 1];
	for (const targetIndex of assistantIndexes) {
		const target = next[targetIndex];
		// Use per-turn metrics already stamped on the message if available.
		// Only fall back to result.usage (total run usage) for the terminal
		// assistant message when no per-turn metrics are present, to avoid
		// attaching session totals to intermediate turn messages.
		let metrics = target.metrics;
		if (!metrics && targetIndex === lastAssistantIndex) {
			const usage = result.usage;
			metrics = {
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.cacheWriteTokens ?? 0,
				cost: usage.totalCost,
			};
		}
		next[targetIndex] = {
			...normalizeStoredMessageModelMetadata(target, {
				id: result.model.id,
				provider: result.model.provider,
				family: result.model.info?.family,
			}),
			...(metrics ? { metrics } : {}),
			ts: target.ts ?? result.endedAt.getTime(),
		};
	}
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
		messagesPath: row.messagesPath ?? undefined,
		updatedAt: row.updatedAt,
	};
}

const MAX_TITLE_LENGTH = 120;

export function normalizeTitle(title?: string | null): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : undefined;
}

export function deriveTitleFromPrompt(
	prompt?: string | null,
): string | undefined {
	const normalized = normalizeUserInput(prompt ?? "").trim();
	if (!normalized) return undefined;
	return normalizeTitle(normalized.split("\n")[0]?.trim());
}

export function sanitizeMetadata(
	metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const next = { ...metadata };
	const title = normalizeTitle(
		typeof next.title === "string" ? next.title : undefined,
	);
	if (title) {
		next.title = title;
	} else {
		delete next.title;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function resolveMetadataWithTitle(input: {
	metadata?: Record<string, unknown> | null;
	title?: string | null;
	prompt?: string | null;
}): Record<string, unknown> | undefined {
	const base = sanitizeMetadata(input.metadata) ?? {};
	const title =
		input.title !== undefined
			? normalizeTitle(input.title)
			: deriveTitleFromPrompt(input.prompt);
	if (title) base.title = title;
	return Object.keys(base).length > 0 ? base : undefined;
}

export type MessagesFileContext = {
	agent: "lead" | "subagent" | "teammate";
	sessionId: string;
	taskType?: string;
};

export function resolveMessagesFileContext(
	sessionId: string,
): MessagesFileContext {
	const teamTaskMatch = parseTeamTaskSubSessionId(sessionId);
	if (teamTaskMatch) {
		return {
			agent: "teammate",
			sessionId: teamTaskMatch.rootSessionId,
			taskType: "team",
		};
	}
	const subSessionMatch = parseSubSessionId(sessionId);
	if (subSessionMatch) {
		return {
			agent: "subagent",
			sessionId: subSessionMatch.rootSessionId,
			taskType: "subagent_task",
		};
	}
	return {
		agent: "lead",
		sessionId,
	};
}

export function buildMessagesFilePayload(input: {
	updatedAt: string;
	context: MessagesFileContext;
	messages: LlmsProviders.MessageWithMetadata[];
	systemPrompt?: string;
}): {
	version: 1;
	updated_at: string;
	agent: "lead" | "subagent" | "teammate";
	sessionId: string;
	taskType?: string;
	messages: StoredMessageWithMetadata[];
	system_prompt?: string;
} {
	return {
		version: 1,
		updated_at: input.updatedAt,
		agent: input.context.agent,
		sessionId: input.context.sessionId,
		...(input.context.taskType ? { taskType: input.context.taskType } : {}),
		messages: normalizeStoredMessagesForPersistence(input.messages),
		...(input.systemPrompt ? { system_prompt: input.systemPrompt } : {}),
	};
}

export function writeEmptyMessagesFile(
	path: string,
	startedAt: string,
	context: MessagesFileContext,
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify(
			buildMessagesFilePayload({
				updatedAt: startedAt,
				context,
				messages: [],
			}),
			null,
			2,
		)}\n`,
		"utf8",
	);
}

export function buildManifestFromRow(
	row: SessionRow,
	overrides?: {
		status?: SessionStatus;
		endedAt?: string;
		exitCode?: number;
		metadata?: Record<string, unknown>;
	},
): SessionManifest {
	return SessionManifestSchema.parse({
		version: 1,
		session_id: row.sessionId,
		source: row.source,
		pid: row.pid,
		started_at: row.startedAt,
		ended_at: overrides?.endedAt ?? row.endedAt ?? undefined,
		exit_code: overrides?.exitCode ?? row.exitCode ?? undefined,
		status: (overrides?.status ?? row.status) as SessionStatus,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspace_root: row.workspaceRoot,
		team_name: row.teamName ?? undefined,
		enable_tools: row.enableTools,
		enable_spawn: row.enableSpawn,
		enable_teams: row.enableTeams,
		prompt: row.prompt ?? undefined,
		metadata: overrides?.metadata ?? row.metadata ?? undefined,
		messages_path: row.messagesPath ?? undefined,
	});
}

export async function withOccRetry<TFetch, TResult>(
	load: () => Promise<TFetch | undefined>,
	update: (loaded: TFetch) => Promise<TResult>,
	maxRetries: number,
): Promise<TResult | { updated: false }> {
	let attempt = 0;
	while (true) {
		const loaded = await load();
		if (loaded === undefined) {
			return { updated: false };
		}
		const result = await update(loaded);
		if (
			typeof result === "object" &&
			result !== null &&
			"updated" in result &&
			(result as { updated?: boolean }).updated === false
		) {
			attempt += 1;
			if (attempt >= maxRetries) {
				return result as TResult;
			}
			continue;
		}
		return result;
	}
}
