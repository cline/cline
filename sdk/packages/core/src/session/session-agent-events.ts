import type { AgentEvent } from "@clinebot/agents";
import {
	captureConversationTurnEvent,
	captureDiffEditFailure,
	captureProviderApiError,
	captureSkillUsed,
	captureTokenUsage,
	captureToolUsage,
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

export function handleAgentEvent(
	ctx: AgentEventContext,
	event: AgentEvent,
): void {
	const { sessionId, config, liveSession, emit } = ctx;
	const telemetry = config.telemetry;

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
			isNativeToolCall: false,
		});
		if (!success && (toolName === "editor" || toolName === "apply_patch")) {
			captureDiffEditFailure(telemetry, {
				ulid: sessionId,
				modelId: config.modelId,
				provider: config.providerId,
				errorType: event.error,
				isNativeToolCall: false,
			});
		}
	}

	if (event.type === "notice" && event.reason === "api_error") {
		captureProviderApiError(telemetry, {
			ulid: sessionId,
			model: config.modelId,
			provider: config.providerId,
			errorMessage: event.message,
		});
	}

	if (event.type === "error") {
		captureProviderApiError(telemetry, {
			ulid: sessionId,
			model: config.modelId,
			provider: config.providerId,
			errorMessage: event.error?.message ?? "unknown error",
		});
	}

	if (event.type === "usage" && liveSession?.turnUsageBaseline) {
		ctx.usageBySession.set(
			sessionId,
			accumulateUsageTotals(liveSession.turnUsageBaseline, {
				inputTokens: event.totalInputTokens,
				outputTokens: event.totalOutputTokens,
				totalCost: event.totalCost,
			}),
		);
		captureConversationTurnEvent(telemetry, {
			ulid: sessionId,
			provider: config.providerId,
			model: config.modelId,
			source: "assistant",
			mode: config.mode,
			tokensIn: event.inputTokens,
			tokensOut: event.outputTokens,
			cacheWriteTokens: event.cacheWriteTokens,
			cacheReadTokens: event.cacheReadTokens,
			totalCost: event.cost,
			isNativeToolCall: false,
		});
		captureTokenUsage(telemetry, {
			ulid: sessionId,
			tokensIn: event.inputTokens,
			tokensOut: event.outputTokens,
			model: config.modelId,
		});
	}

	if (event.type === "iteration_end") {
		ctx.persistMessages(
			sessionId,
			liveSession?.agent.getMessages() ?? [],
			liveSession?.config.systemPrompt,
		);
	}

	emit({
		type: "agent_event",
		payload: { sessionId, event },
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
