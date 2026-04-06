import type {
	AgentEvent,
	DefaultSessionManager,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/core";
import {
	RPC_TEAM_LIFECYCLE_EVENT_TYPE,
	RPC_TEAM_PROGRESS_EVENT_TYPE,
	type TeamProgressProjectionEvent,
} from "@clinebot/core";
import type { RpcSessionClient } from "@clinebot/rpc";

export function createRpcToolApprovalRequester(input: {
	eventClient: RpcSessionClient;
	runtimeClientId: string;
	sessionId: string;
}): (request: ToolApprovalRequest) => Promise<ToolApprovalResult> {
	return async (request) => {
		let inputJson = "";
		try {
			inputJson = JSON.stringify(request.input ?? null);
		} catch {
			inputJson = "";
		}
		const decision = await input.eventClient.requestToolApproval({
			sessionId: input.sessionId,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			inputJson,
			requesterClientId: input.runtimeClientId,
		});
		if (!decision.decided) {
			return {
				approved: false,
				reason:
					decision.reason || `Tool "${request.toolName}" approval timed out`,
			};
		}
		return {
			approved: decision.approved,
			reason: decision.reason || undefined,
		};
	};
}

function publishRuntimeEvent(input: {
	eventClient: RpcSessionClient;
	sessionId: string;
	eventType: string;
	payload: unknown;
}): void {
	const trimmedSessionId = input.sessionId.trim();
	if (!trimmedSessionId) {
		return;
	}
	void input.eventClient
		.publishEvent({
			sessionId: trimmedSessionId,
			eventType: input.eventType,
			payload: (input.payload ?? {}) as Record<string, unknown>,
			sourceClientId: "cli-rpc-runtime",
		})
		.catch(() => {
			// Best effort: runtime execution should not fail on event publish errors.
		});
}

function publishFromAgentEvent(input: {
	eventClient: RpcSessionClient;
	sessionId: string;
	event: AgentEvent;
}): void {
	if (input.event.type === "error") {
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: input.sessionId,
			eventType: "runtime.chat.error",
			payload: {
				message: input.event.error.message,
				recoverable: input.event.recoverable,
				iteration: input.event.iteration,
			},
		});
		return;
	}
	if (
		input.event.type === "content_start" &&
		input.event.contentType === "text"
	) {
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: input.sessionId,
			eventType: "runtime.chat.text_delta",
			payload: {
				text: input.event.text ?? "",
				accumulated: input.event.accumulated,
			},
		});
		return;
	}
	if (
		input.event.type === "content_start" &&
		input.event.contentType === "tool"
	) {
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: input.sessionId,
			eventType: "runtime.chat.tool_call_start",
			payload: {
				toolCallId: input.event.toolCallId,
				toolName: input.event.toolName,
				input: input.event.input,
			},
		});
		return;
	}
	if (
		input.event.type === "content_end" &&
		input.event.contentType === "tool"
	) {
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: input.sessionId,
			eventType: "runtime.chat.tool_call_end",
			payload: {
				toolCallId: input.event.toolCallId,
				toolName: input.event.toolName,
				output: input.event.output,
				error: input.event.error,
				durationMs: input.event.durationMs,
			},
		});
	}
}

export function subscribeRuntimeEventBridge(input: {
	sessionManager: DefaultSessionManager;
	eventClient: RpcSessionClient;
}): () => void {
	return input.sessionManager.subscribe((coreEvent) => {
		if (coreEvent.type === "agent_event") {
			publishFromAgentEvent({
				eventClient: input.eventClient,
				sessionId: coreEvent.payload.sessionId,
				event: coreEvent.payload.event,
			});
			return;
		}
		if (coreEvent.type === "pending_prompts") {
			publishRuntimeEvent({
				eventClient: input.eventClient,
				sessionId: coreEvent.payload.sessionId,
				eventType: "runtime.chat.pending_prompts",
				payload: {
					prompts: coreEvent.payload.prompts,
				},
			});
			return;
		}
		if (coreEvent.type !== "team_progress") {
			return;
		}
		const payload: TeamProgressProjectionEvent = {
			type: "team_progress_projection",
			version: 1,
			sessionId: coreEvent.payload.sessionId,
			summary: coreEvent.payload.summary,
			lastEvent: coreEvent.payload.lifecycle,
		};
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: coreEvent.payload.sessionId,
			eventType: RPC_TEAM_PROGRESS_EVENT_TYPE,
			payload,
		});
		publishRuntimeEvent({
			eventClient: input.eventClient,
			sessionId: coreEvent.payload.sessionId,
			eventType: RPC_TEAM_LIFECYCLE_EVENT_TYPE,
			payload: coreEvent.payload.lifecycle,
		});
	});
}
