import type {
	HookDispatchInput,
	HookEngine,
	HookStage,
} from "@clinebot/shared";
import type { AgentEvent, AgentHookControl } from "../types";
import type { AgentRuntimeBus } from "./agent-runtime-bus";

export interface LifecycleOrchestratorOptions {
	hookEngine: HookEngine;
	runtimeBus: AgentRuntimeBus;
	getRunId: () => string;
	getAgentId: () => string;
	getConversationId: () => string;
	getParentAgentId: () => string | null;
	onHookContext?: (source: string, context: string) => void;
	onDispatchError?: (error: unknown) => void;
}

export class LifecycleOrchestrator {
	private readonly hookEngine: HookEngine;
	private readonly runtimeBus: AgentRuntimeBus;
	private readonly getRunId: () => string;
	private readonly getAgentId: () => string;
	private readonly getConversationId: () => string;
	private readonly getParentAgentId: () => string | null;
	private readonly onHookContext?: (source: string, context: string) => void;
	private readonly onDispatchError?: (error: unknown) => void;

	constructor(options: LifecycleOrchestratorOptions) {
		this.hookEngine = options.hookEngine;
		this.runtimeBus = options.runtimeBus;
		this.getRunId = options.getRunId;
		this.getAgentId = options.getAgentId;
		this.getConversationId = options.getConversationId;
		this.getParentAgentId = options.getParentAgentId;
		this.onHookContext = options.onHookContext;
		this.onDispatchError = options.onDispatchError;
	}

	async dispatch(
		source: string,
		input: Pick<
			HookDispatchInput,
			"stage" | "payload" | "iteration" | "parentEventId"
		>,
	): Promise<AgentHookControl | undefined> {
		this.runtimeBus.emitLifecycleEvent({
			stage: input.stage,
			iteration: input.iteration,
			payload: input.payload,
		});

		const dispatchResult = await this.hookEngine.dispatch({
			...input,
			runId: this.getRunId(),
			agentId: this.getAgentId(),
			conversationId: this.getConversationId(),
			parentAgentId: this.getParentAgentId(),
		});
		if (dispatchResult.control?.context) {
			this.onHookContext?.(source, dispatchResult.control.context);
		}
		return dispatchResult.control as AgentHookControl | undefined;
	}

	dispatchRuntimeEvent(event: AgentEvent): void {
		void this.hookEngine
			.dispatch({
				stage: "runtime_event",
				runId: this.getRunId(),
				agentId: this.getAgentId(),
				conversationId: this.getConversationId(),
				parentAgentId: this.getParentAgentId(),
				payload: {
					agentId: this.getAgentId(),
					conversationId: this.getConversationId(),
					parentAgentId: this.getParentAgentId(),
					event,
				},
			})
			.catch((error) => {
				this.onDispatchError?.(error);
			});
	}

	async shutdown(timeoutMs?: number): Promise<void> {
		await this.hookEngine.shutdown(timeoutMs);
	}
}

export function isBlockingLifecycleStage(stage: HookStage): boolean {
	return stage !== "runtime_event";
}
