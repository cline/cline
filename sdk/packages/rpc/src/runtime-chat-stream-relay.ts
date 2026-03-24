import type {
	RpcRuntimeChatClient,
	RpcRuntimeEvent,
	RpcRuntimeStreamStop,
} from "./runtime-chat-client.js";

export type RpcRuntimeBridgeStreamLine =
	| {
			type: "chat_text";
			sessionId: string;
			chunk: string;
	  }
	| {
			type: "tool_call_start";
			sessionId: string;
			toolCallId?: string;
			toolName?: string;
			input?: unknown;
	  }
	| {
			type: "tool_call_end";
			sessionId: string;
			toolCallId?: string;
			toolName?: string;
			output?: unknown;
			error?: string;
			durationMs?: number;
	  }
	| {
			type: "pending_prompts";
			sessionId: string;
			prompts: unknown[];
	  }
	| {
			type: "error";
			message: string;
	  };

export type RpcRuntimeStreamRelay = {
	applySessions: (sessionIds: string[]) => void;
	resetSession: (sessionId?: string) => void;
	stop: () => void;
};

function normalizeSessionIds(sessionIds: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of sessionIds) {
		const value = raw.trim();
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

function areSessionListsEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	previous: string,
): {
	delta: string;
	nextAccumulated: string;
} {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(previous)) {
			return {
				delta: accumulated.slice(previous.length),
				nextAccumulated: accumulated,
			};
		}
		if (previous.startsWith(accumulated)) {
			return {
				delta: "",
				nextAccumulated: previous,
			};
		}
	}
	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextAccumulated: `${previous}${text}`,
	};
}

export function createRpcRuntimeStreamRelay(options: {
	client: RpcRuntimeChatClient;
	clientId: string;
	writeLine: (line: RpcRuntimeBridgeStreamLine) => void;
}): RpcRuntimeStreamRelay {
	let stopStreaming: RpcRuntimeStreamStop | undefined;
	let activeSessionIds: string[] = [];
	const accumulatedBySession = new Map<string, string>();

	const stop = () => {
		stopStreaming?.();
		stopStreaming = undefined;
	};

	const restartStream = () => {
		stop();
		if (activeSessionIds.length === 0) {
			return;
		}
		stopStreaming = options.client.streamEvents(
			options.clientId,
			activeSessionIds,
			{
				onEvent: (event: RpcRuntimeEvent) => {
					const payload = event.payload;
					if (event.eventType === "runtime.chat.text_delta") {
						const prev = accumulatedBySession.get(event.sessionId) ?? "";
						const resolved = resolveTextDelta(payload, prev);
						accumulatedBySession.set(event.sessionId, resolved.nextAccumulated);
						if (!resolved.delta) {
							return;
						}
						options.writeLine({
							type: "chat_text",
							sessionId: event.sessionId,
							chunk: resolved.delta,
						});
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_start") {
						options.writeLine({
							type: "tool_call_start",
							sessionId: event.sessionId,
							toolCallId:
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: undefined,
							toolName:
								typeof payload.toolName === "string"
									? payload.toolName
									: undefined,
							input: payload.input,
						});
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_end") {
						options.writeLine({
							type: "tool_call_end",
							sessionId: event.sessionId,
							toolCallId:
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: undefined,
							toolName:
								typeof payload.toolName === "string"
									? payload.toolName
									: undefined,
							output: payload.output,
							error:
								typeof payload.error === "string" ? payload.error : undefined,
							durationMs:
								typeof payload.durationMs === "number"
									? payload.durationMs
									: undefined,
						});
						return;
					}
					if (event.eventType === "runtime.chat.pending_prompts") {
						options.writeLine({
							type: "pending_prompts",
							sessionId: event.sessionId,
							prompts: Array.isArray(payload.prompts) ? payload.prompts : [],
						});
					}
				},
				onError: (error: Error) => {
					options.writeLine({
						type: "error",
						message: error.message,
					});
				},
			},
		);
	};

	return {
		applySessions: (nextSessionIds: string[]) => {
			const normalized = normalizeSessionIds(nextSessionIds).sort();
			if (areSessionListsEqual(activeSessionIds, normalized)) {
				return;
			}
			activeSessionIds = normalized;
			for (const key of Array.from(accumulatedBySession.keys())) {
				if (!normalized.includes(key)) {
					accumulatedBySession.delete(key);
				}
			}
			restartStream();
		},
		resetSession: (sessionId?: string) => {
			const normalized = sessionId?.trim();
			if (normalized) {
				accumulatedBySession.delete(normalized);
				return;
			}
			accumulatedBySession.clear();
		},
		stop,
	};
}
