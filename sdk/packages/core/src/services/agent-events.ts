import type { AgentEvent } from "@bedrock-coder/shared";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { ActiveSession } from "../types/session";
import { serializeAgentEvent } from "./session-data";
import {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
	sumUsageTotals,
} from "./usage";

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
	aggregateUsageBySession: Map<string, SessionAccumulatedUsage>;
	persistMessages: (
		sessionId: string,
		messages: unknown[],
		systemPrompt?: string,
	) => void;
	emit: (event: CoreSessionEvent) => void;
}

export interface AgentEventContextOverrides {
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

function usageDeltaFromEvent(event: Extract<AgentEvent, { type: "usage" }>) {
	return {
		inputTokens: event.inputTokens,
		outputTokens: event.outputTokens,
		cacheWriteTokens: event.cacheWriteTokens,
		cacheReadTokens: event.cacheReadTokens,
		totalCost: event.cost,
	};
}

function resolveUsageAgentKey(input: {
	isPrimaryAgentEvent: boolean;
	overrides?: AgentEventContextOverrides;
	eventMetadata: ReturnType<typeof extractAgentEventMetadata>;
}): string {
	const candidates = input.isPrimaryAgentEvent
		? [
				input.overrides?.agentId,
				input.eventMetadata.agentId,
				input.overrides?.teamAgentId,
			]
		: [
				input.overrides?.teamAgentId,
				input.overrides?.agentId,
				input.eventMetadata.agentId,
				input.eventMetadata.conversationId,
			];
	for (const candidate of candidates) {
		const value = candidate?.trim();
		if (value) return value;
	}
	return input.isPrimaryAgentEvent ? "root" : "unknown";
}

export function handleAgentEvent(
	ctx: AgentEventContext,
	event: AgentEvent,
	overrides?: AgentEventContextOverrides,
): void {
	const { sessionId, liveSession, emit } = ctx;
	const isPrimaryAgentEvent = overrides?.isPrimaryAgentEvent ?? true;
	const eventMetadata = extractAgentEventMetadata(event);

	if (event.type === "usage" && liveSession?.turnUsageBaseline) {
		const usageDelta = usageDeltaFromEvent(event);
		if (isPrimaryAgentEvent) {
			liveSession.turnPrimaryUsage = accumulateUsageTotals(
				liveSession.turnPrimaryUsage ?? createInitialAccumulatedUsage(),
				usageDelta,
			);
			const mainUsage = accumulateUsageTotals(
				liveSession.turnUsageBaseline,
				liveSession.turnPrimaryUsage,
			);
			ctx.usageBySession.set(sessionId, mainUsage);
		} else {
			const agentKey = resolveUsageAgentKey({
				isPrimaryAgentEvent,
				overrides,
				eventMetadata,
			});
			const turnUsageByAgent =
				liveSession.turnUsageByAgent ??
				new Map<string, SessionAccumulatedUsage>();
			liveSession.turnUsageByAgent = turnUsageByAgent;
			turnUsageByAgent.set(
				agentKey,
				accumulateUsageTotals(
					turnUsageByAgent.get(agentKey) ?? createInitialAccumulatedUsage(),
					usageDelta,
				),
			);
		}
		const aggregateTurnUsage = accumulateUsageTotals(
			liveSession.turnPrimaryUsage ?? createInitialAccumulatedUsage(),
			sumUsageTotals(liveSession.turnUsageByAgent?.values() ?? []),
		);
		ctx.aggregateUsageBySession.set(
			sessionId,
			accumulateUsageTotals(
				liveSession.turnAggregateUsageBaseline ?? liveSession.turnUsageBaseline,
				aggregateTurnUsage,
			),
		);
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
