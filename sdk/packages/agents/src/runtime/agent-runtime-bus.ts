import type { HookStage } from "@clinebot/shared";
import type { AgentEvent } from "../types";

export interface LifecycleBusEvent<TPayload = unknown> {
	stage: HookStage;
	iteration?: number;
	payload: TPayload;
}

export interface AgentRuntimeBus {
	subscribeRuntimeEvent: (listener: (event: AgentEvent) => void) => () => void;
	subscribeLifecycleEvent: (
		listener: (event: LifecycleBusEvent) => void,
	) => () => void;
	emitRuntimeEvent: (event: AgentEvent) => void;
	emitLifecycleEvent: <TPayload>(event: LifecycleBusEvent<TPayload>) => void;
}

export function createAgentRuntimeBus(): AgentRuntimeBus {
	let runtimeSeq = 0;
	let lifecycleSeq = 0;
	const runtimeListeners = new Map<number, (event: AgentEvent) => void>();
	const lifecycleListeners = new Map<
		number,
		(event: LifecycleBusEvent) => void
	>();

	return {
		subscribeRuntimeEvent: (listener) => {
			const id = ++runtimeSeq;
			runtimeListeners.set(id, listener);
			return () => {
				runtimeListeners.delete(id);
			};
		},
		subscribeLifecycleEvent: (listener) => {
			const id = ++lifecycleSeq;
			lifecycleListeners.set(id, listener);
			return () => {
				lifecycleListeners.delete(id);
			};
		},
		emitRuntimeEvent: (event) => {
			for (const listener of runtimeListeners.values()) {
				listener(event);
			}
		},
		emitLifecycleEvent: (event) => {
			for (const listener of lifecycleListeners.values()) {
				listener(event);
			}
		},
	};
}
