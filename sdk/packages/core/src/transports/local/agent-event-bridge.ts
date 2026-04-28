import type {
	AgentEvent,
	AutomationEventEnvelope,
	BasicLogger,
	BasicLogMetadata,
} from "@clinebot/shared";
import type { TeamEvent } from "../../extensions/tools/team";
import type { SessionAccumulatedUsage } from "../../runtime/host/runtime-host";
import type { SessionRuntime } from "../../runtime/orchestration/session-runtime-orchestrator";
import {
	type AgentEventContext,
	buildTelemetryAgentIdentity,
	extractAgentEventMetadata,
	handleAgentEvent,
} from "../../services/agent-events";
import { captureAgentCreated } from "../../services/telemetry/core-events";
import {
	dispatchTeamEventToBackend,
	emitTeamProgress,
	trackTeamRunState,
} from "../../session/team";
import type { CoreSessionConfig } from "../../types/config";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession } from "../../types/session";

export interface AgentEventBridgeDeps {
	getSession(sessionId: string): ActiveSession | undefined;
	usageBySession: Map<string, SessionAccumulatedUsage>;
	emit(event: CoreSessionEvent): void;
	persistMessages: AgentEventContext["persistMessages"];
	enqueuePendingPrompt(
		sessionId: string,
		entry: { prompt: string; delivery: "queue" | "steer" },
	): void;
	invokeBackendOptional(method: string, ...args: unknown[]): Promise<void>;
}

export class AgentEventBridge {
	constructor(private readonly deps: AgentEventBridgeDeps) {}

	dispatchAgentEvent(
		sessionId: string,
		config: CoreSessionConfig,
		event: AgentEvent,
	): void {
		const liveSession = this.deps.getSession(sessionId);
		const ctx: AgentEventContext = {
			sessionId,
			config,
			liveSession,
			usageBySession: this.deps.usageBySession,
			persistMessages: this.deps.persistMessages,
			emit: this.deps.emit,
		};
		const eventMetadata = extractAgentEventMetadata(event);
		const isRootAgentEvent =
			liveSession && eventMetadata.agentId === readAgentId(liveSession.agent);
		handleAgentEvent(
			ctx,
			event,
			isRootAgentEvent
				? {
						isPrimaryAgentEvent: true,
						...(liveSession?.runtime.teamRuntime
							? { teamRole: "lead" as const }
							: {}),
					}
				: { isPrimaryAgentEvent: false },
		);
	}

	async handleTeamEvent(
		rootSessionId: string,
		event: TeamEvent,
	): Promise<void> {
		const session = this.deps.getSession(rootSessionId);
		if (session) {
			trackTeamRunState(session, event);
			if (event.type === "agent_event") {
				const ctx: AgentEventContext = {
					sessionId: rootSessionId,
					config: session.config,
					liveSession: session,
					usageBySession: this.deps.usageBySession,
					persistMessages: this.deps.persistMessages,
					emit: this.deps.emit,
				};
				handleAgentEvent(ctx, event.event, {
					teamRole: "teammate",
					teamAgentId: event.agentId,
					isPrimaryAgentEvent: false,
				});
			}
			if (event.type === "teammate_spawned") {
				const agentIdentity = buildTelemetryAgentIdentity({
					agentId: event.teammate.runtimeAgentId ?? event.agentId,
					conversationId: event.teammate.conversationId,
					parentAgentId: event.teammate.parentAgentId,
					createdByAgentId: readAgentId(session.agent),
					teamId: session.runtime.teamRuntime?.getTeamId(),
					teamName: session.runtime.teamRuntime?.getTeamName(),
					teamRole: "teammate",
					teamAgentId: event.agentId,
				});
				if (agentIdentity) {
					captureAgentCreated(session.config.telemetry, {
						ulid: rootSessionId,
						modelId: event.teammate.modelId ?? session.config.modelId,
						provider: session.config.providerId,
						...agentIdentity,
					});
				}
			}
		}

		await dispatchTeamEventToBackend(
			rootSessionId,
			event,
			this.deps.invokeBackendOptional,
		);

		if (session) {
			emitTeamProgress(session, rootSessionId, event, this.deps.emit);
		}
	}

	async handlePluginEvent(
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: NonNullable<
			CoreSessionConfig["extensionContext"]
		>["automation"],
	): Promise<void> {
		if (event.name === "plugin_log") {
			this.handlePluginLog(rootSessionId, event.payload);
			return;
		}
		if (event.name === "automation_event") {
			const session = this.deps.getSession(rootSessionId);
			const automation =
				session?.config.extensionContext?.automation ?? fallbackAutomation;
			if (!automation) return;
			const payload =
				event.payload && typeof event.payload === "object"
					? (event.payload as AutomationEventEnvelope)
					: undefined;
			if (!payload) return;
			await automation.ingestEvent(payload);
			return;
		}
		if (
			event.name !== "steer_message" &&
			event.name !== "queue_message" &&
			event.name !== "pending_prompt"
		) {
			return;
		}
		const payload =
			event.payload && typeof event.payload === "object"
				? (event.payload as Record<string, unknown>)
				: undefined;
		const targetSessionId =
			typeof payload?.sessionId === "string" &&
			payload.sessionId.trim().length > 0
				? payload.sessionId.trim()
				: rootSessionId;
		const prompt =
			typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
		if (!prompt) return;
		const delivery: "queue" | "steer" =
			event.name === "steer_message"
				? "steer"
				: event.name === "queue_message"
					? "queue"
					: payload?.delivery === "steer"
						? "steer"
						: "queue";
		this.deps.enqueuePendingPrompt(targetSessionId, { prompt, delivery });
	}

	handlePluginLog(
		rootSessionId: string,
		payload: unknown,
		fallbackLogger?: BasicLogger,
	): void {
		const session = this.deps.getSession(rootSessionId);
		const logger =
			fallbackLogger ??
			session?.config.extensionContext?.logger ??
			session?.config.logger;
		if (!logger || !payload || typeof payload !== "object") return;
		const record = payload as Record<string, unknown>;
		const message = typeof record.message === "string" ? record.message : "";
		if (!message) return;
		const metadata =
			record.metadata && typeof record.metadata === "object"
				? ({
						...(record.metadata as Record<string, unknown>),
					} as BasicLogMetadata)
				: {};
		metadata.sessionId ??= rootSessionId;
		if (typeof record.pluginName === "string" && record.pluginName) {
			metadata.pluginName = record.pluginName;
		}
		if (record.level === "debug") {
			logger.debug(message, metadata);
			return;
		}
		if (record.level === "error") {
			if (logger.error) {
				logger.error(message, metadata);
			} else {
				logger.log(message, { ...metadata, severity: "error" });
			}
			return;
		}
		logger.log(message, metadata);
	}
}

function readAgentId(agent: SessionRuntime): string {
	return agent.getAgentId();
}
