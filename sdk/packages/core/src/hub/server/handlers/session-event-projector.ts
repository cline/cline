import type { TeamProgressProjectionEvent } from "@cline/shared";
import type { SessionUsageSummary } from "../../../runtime/host/runtime-host";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../../types/events";
import { buildCompletionNotification } from "../hub-notifications";
import {
	type HubTransportContext,
	readCoreSessionSnapshot,
	readHubSessionRecord,
} from "./context";

/**
 * Translates internal `CoreSessionEvent`s emitted by the session host into the
 * outward-facing `HubEventEnvelope` stream.
 */
export async function projectSessionEvent(
	ctx: HubTransportContext,
	event: CoreSessionEvent,
): Promise<void> {
	switch (event.type) {
		case "chunk":
			// Ignore raw agent chunks here. In this runtime they can contain
			// serialized event envelopes rather than user-facing assistant text.
			// Structured live content is forwarded via the "agent_event" branch.
			return;
		case "agent_event":
			await projectAgentEvent(ctx, event);
			return;
		case "hook":
			if (event.payload.hookEventName === "tool_call") {
				ctx.publish(
					ctx.buildEvent(
						"tool.started",
						{ toolName: event.payload.toolName },
						event.payload.sessionId,
					),
				);
			} else if (event.payload.hookEventName === "tool_result") {
				ctx.publish(
					ctx.buildEvent(
						"tool.finished",
						{ toolName: event.payload.toolName },
						event.payload.sessionId,
					),
				);
			}
			return;
		case "team_progress": {
			const projection: TeamProgressProjectionEvent = {
				type: "team_progress_projection",
				version: 1,
				sessionId: event.payload.sessionId,
				summary: event.payload.summary,
				lastEvent: event.payload.lifecycle,
			};
			ctx.publish(
				ctx.buildEvent(
					"team.progress",
					projection as unknown as Record<string, unknown>,
					event.payload.sessionId,
				),
			);
			return;
		}
		case "pending_prompts":
			ctx.publish(
				ctx.buildEvent(
					"session.pending_prompts",
					{
						sessionId: event.payload.sessionId,
						prompts: event.payload.prompts,
					},
					event.payload.sessionId,
				),
			);
			return;
		case "pending_prompt_submitted": {
			const prompt: SessionPendingPrompt = {
				id: event.payload.id,
				prompt: event.payload.prompt,
				delivery: event.payload.delivery,
				attachmentCount: event.payload.attachmentCount,
			};
			ctx.publish(
				ctx.buildEvent(
					"session.pending_prompt_submitted",
					{ sessionId: event.payload.sessionId, prompt },
					event.payload.sessionId,
				),
			);
			return;
		}
		case "session_snapshot":
			ctx.publish(
				ctx.buildEvent(
					"session.updated",
					{
						sessionId: event.payload.sessionId,
						snapshot: event.payload.snapshot,
					},
					event.payload.sessionId,
				),
			);
			return;
		case "status": {
			const [session, snapshot] = await Promise.all([
				readHubSessionRecord(ctx, event.payload.sessionId),
				readCoreSessionSnapshot(ctx, event.payload.sessionId),
			]);
			if (session) {
				ctx.publish(
					ctx.buildEvent(
						"session.updated",
						{ session, ...(snapshot ? { snapshot } : {}) },
						event.payload.sessionId,
					),
				);
			}
			return;
		}
		case "ended":
			await projectSessionEnded(ctx, event);
			return;
		default:
			return;
	}
}

async function projectAgentEvent(
	ctx: HubTransportContext,
	event: Extract<CoreSessionEvent, { type: "agent_event" }>,
): Promise<void> {
	const { sessionId, event: agentEvent } = event.payload;
	if (agentEvent.type === "iteration_start") {
		ctx.publish(
			ctx.buildEvent(
				"iteration.started",
				{ iteration: agentEvent.iteration },
				sessionId,
			),
		);
		return;
	}
	if (agentEvent.type === "iteration_end") {
		ctx.publish(
			ctx.buildEvent(
				"iteration.finished",
				{
					iteration: agentEvent.iteration,
					hadToolCalls: agentEvent.hadToolCalls,
					toolCallCount: agentEvent.toolCallCount,
				},
				sessionId,
			),
		);
		return;
	}
	if (agentEvent.type === "content_start") {
		if (
			agentEvent.contentType === "text" &&
			typeof agentEvent.text === "string" &&
			agentEvent.text.length > 0
		) {
			ctx.publish(
				ctx.buildEvent("assistant.delta", { text: agentEvent.text }, sessionId),
			);
			return;
		}
		if (agentEvent.contentType === "reasoning") {
			if (agentEvent.redacted && !agentEvent.reasoning) {
				ctx.publish(
					ctx.buildEvent(
						"reasoning.delta",
						{ text: "", redacted: true },
						sessionId,
					),
				);
				return;
			}
			if (
				typeof agentEvent.reasoning === "string" &&
				agentEvent.reasoning.length > 0
			) {
				ctx.publish(
					ctx.buildEvent(
						"reasoning.delta",
						{
							text: agentEvent.reasoning,
							redacted: agentEvent.redacted === true,
						},
						sessionId,
					),
				);
			}
			return;
		}
		if (agentEvent.contentType === "tool") {
			ctx.publish(
				ctx.buildEvent(
					"tool.started",
					{
						toolCallId: agentEvent.toolCallId,
						toolName: agentEvent.toolName,
						input: agentEvent.input,
					},
					sessionId,
				),
			);
			return;
		}
	}
	if (agentEvent.type === "content_end") {
		switch (agentEvent.contentType) {
			case "text":
				ctx.publish(
					ctx.buildEvent(
						"assistant.finished",
						{ text: agentEvent.text },
						sessionId,
					),
				);
				break;
			case "reasoning":
				ctx.publish(
					ctx.buildEvent(
						"reasoning.finished",
						{ reasoning: agentEvent.reasoning },
						sessionId,
					),
				);
				break;
			case "tool":
				ctx.publish(
					ctx.buildEvent(
						"tool.finished",
						{
							toolCallId: agentEvent.toolCallId,
							toolName: agentEvent.toolName,
							output: agentEvent.output,
							error: agentEvent.error,
						},
						sessionId,
					),
				);
				break;
		}
		return;
	}
	if (agentEvent.type === "usage") {
		let usageSummary: SessionUsageSummary | undefined;
		try {
			usageSummary = await ctx.sessionHost.getAccumulatedUsage?.(sessionId);
		} catch {
			usageSummary = undefined;
		}
		ctx.publish(
			ctx.buildEvent(
				"usage.updated",
				{
					sessionId,
					delta: {
						inputTokens: agentEvent.inputTokens,
						outputTokens: agentEvent.outputTokens,
						cacheReadTokens: agentEvent.cacheReadTokens ?? 0,
						cacheWriteTokens: agentEvent.cacheWriteTokens ?? 0,
						totalCost: agentEvent.cost ?? 0,
					},
					totals: {
						inputTokens: agentEvent.totalInputTokens,
						outputTokens: agentEvent.totalOutputTokens,
						cacheReadTokens: agentEvent.totalCacheReadTokens ?? 0,
						cacheWriteTokens: agentEvent.totalCacheWriteTokens ?? 0,
						totalCost: agentEvent.totalCost ?? 0,
					},
					usage: usageSummary?.usage,
					aggregateUsage: usageSummary?.aggregateUsage,
					agent: {
						kind:
							event.payload.teamRole === "teammate"
								? "teammate"
								: agentEvent.parentAgentId
									? "subagent"
									: "lead",
						agentId: agentEvent.agentId,
						conversationId: agentEvent.conversationId,
						parentAgentId: agentEvent.parentAgentId,
						teamAgentId: event.payload.teamAgentId,
						teamRole: event.payload.teamRole,
					},
				},
				sessionId,
			),
		);
		return;
	}
	if (agentEvent.type === "done") {
		ctx.publish(
			ctx.buildEvent(
				"agent.done",
				{
					reason: agentEvent.reason,
					text: agentEvent.text,
					iterations: agentEvent.iterations,
					usage: agentEvent.usage,
				},
				sessionId,
			),
		);
	}
}

async function projectSessionEnded(
	ctx: HubTransportContext,
	event: Extract<CoreSessionEvent, { type: "ended" }>,
): Promise<void> {
	// `run.start` publishes the result-bearing terminal event after `send`
	// returns. The local runtime emits `ended` synchronously during that send, so
	// this token suppresses the earlier projector event. If session events move
	// to an async transport, terminal-event correlation must move with them.
	const suppressToken = ctx.suppressNextTerminalEventBySession.get(
		event.payload.sessionId,
	);
	const suppressDuplicateTerminalEvent =
		suppressToken === event.payload.reason ||
		suppressToken === "run.start.reply";
	if (suppressDuplicateTerminalEvent) {
		ctx.suppressNextTerminalEventBySession.delete(event.payload.sessionId);
	}
	const [session, snapshot] = await Promise.all([
		readHubSessionRecord(ctx, event.payload.sessionId),
		readCoreSessionSnapshot(ctx, event.payload.sessionId),
	]);
	if (event.payload.reason === "completed") {
		const notification = await buildCompletionNotification(session);
		ctx.publish(
			ctx.buildEvent("ui.notify", notification, event.payload.sessionId),
		);
	}
	if (suppressDuplicateTerminalEvent) {
		return;
	}
	ctx.publish(
		ctx.buildEvent(
			event.payload.reason === "aborted"
				? "run.aborted"
				: event.payload.reason === "error" || event.payload.reason === "failed"
					? "run.failed"
					: "run.completed",
			{ reason: event.payload.reason, ...(snapshot ? { snapshot } : {}) },
			event.payload.sessionId,
		),
	);
}
