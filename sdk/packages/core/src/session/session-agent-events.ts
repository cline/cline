import type { AgentEvent } from "@clinebot/shared";
import {
	captureConversationTurnEvent,
	captureDiffEditFailure,
	captureProviderApiError,
	captureSkillUsed,
	captureTokenUsage,
	captureToolUsage,
	type TelemetryAgentIdentityProperties,
} from "../telemetry/core-events";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionAccumulatedUsage } from "./session-manager";
import { serializeAgentEvent } from "./utils/helpers";
import type { ActiveSession } from "./utils/types";
import { accumulateUsageTotals } from "./utils/usage";

export function extractSkillNameFromToolInput(
	input: unknown,
): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const skillName = record.skill ?? record.skill_name ?? record.skillName;
	if (typeof skillName !== "string") return undefined;
	const trimmed = skillName.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export interface AgentEventContext {
	sessionId: string;
	config: CoreSessionConfig;
	liveSession: ActiveSession | undefined;
	usageBySession: Map<string, SessionAccumulatedUsage>;
	persistMessages: (
		sessionId: string,
		messages: unknown[],
		systemPrompt?: string,
	) => void;
	emit: (event: CoreSessionEvent) => void;
}

export interface AgentTelemetryContextOverrides {
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string | null;
	createdByAgentId?: string;
	teamId?: string;
	teamName?: string;
	teamRole?: "lead" | "teammate";
	teamAgentId?: string;
	isPrimaryAgentEvent?: boolean;
}

export function extractAgentEventMetadata(event: AgentEvent): {
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string;
} {
	if (!event || typeof event !== "object") {
		return {};
	}
	const record = event as unknown as Record<string, unknown>;
	return {
		agentId: typeof record.agentId === "string" ? record.agentId : undefined,
		conversationId:
			typeof record.conversationId === "string"
				? record.conversationId
				: undefined,
		parentAgentId:
			typeof record.parentAgentId === "string"
				? record.parentAgentId
				: undefined,
	};
}

export function buildTelemetryAgentIdentity(
	context: AgentTelemetryContextOverrides,
): TelemetryAgentIdentityProperties | undefined {
	const agentId = context.agentId?.trim();
	if (!agentId) {
		return undefined;
	}
	const parentAgentId = context.parentAgentId?.trim() || undefined;
	const teamRole = context.teamRole;
	let agentKind: TelemetryAgentIdentityProperties["agentKind"] = "root";
	if (teamRole === "teammate") {
		agentKind = "team_teammate";
	} else if (teamRole === "lead") {
		agentKind = "team_lead";
	} else if (parentAgentId) {
		agentKind = "subagent";
	}
	return {
		agentId,
		agentKind,
		conversationId: context.conversationId?.trim() || undefined,
		parentAgentId,
		createdByAgentId:
			context.createdByAgentId?.trim() || parentAgentId || undefined,
		isSubagent: Boolean(parentAgentId),
		teamId: context.teamId?.trim() || undefined,
		teamName: context.teamName?.trim() || undefined,
		teamRole,
		teamAgentId: context.teamAgentId?.trim() || undefined,
	};
}

export function handleAgentEvent(
	ctx: AgentEventContext,
	event: AgentEvent,
	overrides?: AgentTelemetryContextOverrides,
): void {
	const { sessionId, config, liveSession, emit } = ctx;
	const telemetry = config.telemetry;
	const teamRuntime = liveSession?.runtime.teamRuntime;
	const isPrimaryAgentEvent = overrides?.isPrimaryAgentEvent ?? true;
	const eventMetadata = extractAgentEventMetadata(event);
	const agentIdentity = buildTelemetryAgentIdentity({
		agentId: overrides?.agentId ?? eventMetadata.agentId,
		conversationId: overrides?.conversationId ?? eventMetadata.conversationId,
		parentAgentId: overrides?.parentAgentId ?? eventMetadata.parentAgentId,
		createdByAgentId: overrides?.createdByAgentId,
		teamId: overrides?.teamId ?? teamRuntime?.getTeamId(),
		teamName: overrides?.teamName ?? teamRuntime?.getTeamName(),
		teamRole: overrides?.teamRole,
		teamAgentId: overrides?.teamAgentId,
	});

	if (
		event.type === "content_start" &&
		event.contentType === "tool" &&
		event.toolName === "skills"
	) {
		const skillName = extractSkillNameFromToolInput(event.input);
		if (skillName) {
			captureSkillUsed(telemetry, {
				ulid: sessionId,
				skillName,
				skillSource: "project",
				skillsAvailableGlobal: 0,
				skillsAvailableProject: 0,
				provider: config.providerId,
				modelId: config.modelId,
				...agentIdentity,
			});
		}
	}

	if (event.type === "content_end" && event.contentType === "tool") {
		const toolName = event.toolName ?? "unknown";
		const success = !event.error;
		captureToolUsage(telemetry, {
			ulid: sessionId,
			tool: toolName,
			autoApproved: undefined,
			success,
			modelId: config.modelId,
			provider: config.providerId,
			...agentIdentity,
		});
		if (!success && (toolName === "editor" || toolName === "apply_patch")) {
			captureDiffEditFailure(telemetry, {
				ulid: sessionId,
				modelId: config.modelId,
				provider: config.providerId,
				errorType: event.error,
				...agentIdentity,
			});
		}
	}

	if (event.type === "notice" && event.reason === "api_error") {
		captureProviderApiError(telemetry, {
			ulid: sessionId,
			model: config.modelId,
			provider: config.providerId,
			errorMessage: event.message,
			...agentIdentity,
		});
	}

	if (event.type === "error") {
		captureProviderApiError(telemetry, {
			ulid: sessionId,
			model: config.modelId,
			provider: config.providerId,
			errorMessage: event.error?.message ?? "unknown error",
			...agentIdentity,
		});
	}

	if (
		event.type === "usage" &&
		isPrimaryAgentEvent &&
		liveSession?.turnUsageBaseline
	) {
		ctx.usageBySession.set(
			sessionId,
			accumulateUsageTotals(liveSession.turnUsageBaseline, {
				inputTokens: event.inputTokens,
				outputTokens: event.outputTokens,
				cacheWriteTokens: event.cacheWriteTokens,
				cacheReadTokens: event.cacheReadTokens,
				totalCost: event.cost,
			}),
		);
		captureConversationTurnEvent(telemetry, {
			ulid: sessionId,
			provider: config.providerId,
			model: config.modelId,
			source: "assistant",
			mode: config.mode,
			...agentIdentity,
		});
		captureTokenUsage(telemetry, {
			ulid: sessionId,
			tokensIn: event.inputTokens,
			tokensOut: event.outputTokens,
			cacheWriteTokens: event.cacheWriteTokens,
			cacheReadTokens: event.cacheReadTokens,
			totalCost: event.cost,
			model: config.modelId,
			...agentIdentity,
		});
	}

	if (event.type === "iteration_end" && isPrimaryAgentEvent) {
		ctx.persistMessages(
			sessionId,
			liveSession?.agent.getMessages() ?? [],
			liveSession?.config.systemPrompt,
		);
	}

	emit({
		type: "agent_event",
		payload: {
			sessionId,
			event,
			teamAgentId: overrides?.teamAgentId,
			teamRole:
				overrides !== undefined
					? (overrides.teamRole ?? (isPrimaryAgentEvent ? "lead" : undefined))
					: undefined,
		},
	});
	emit({
		type: "chunk",
		payload: {
			sessionId,
			stream: "agent",
			chunk: serializeAgentEvent(event),
			ts: Date.now(),
		},
	});
}
