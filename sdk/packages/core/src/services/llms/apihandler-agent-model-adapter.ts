/**
 * Adapter: wrap a custom `ApiHandler` (from the `@cline/llms` handler registry)
 * as an `AgentModel` for the agent runtime.
 *
 * The agent runtime builds models via `createAgentModelFromConfig`, which goes
 * straight to the gateway. Hosts can register provider handlers that need
 * host-only dependencies (e.g. the VS Code `vscode.lm` API) via
 * `registerHandler(providerId, factory)`. Those produce an `ApiHandler`
 * (`createMessage` -> `ApiStreamChunk`), which this adapter converts into the
 * `AgentModel` contract (`stream` -> `AgentModelEvent`).
 *
 * This is the inverse of the gateway's `toApiStreamChunk` in
 * `@cline/llms` `compat.ts`.
 */

import {
	type ApiHandler,
	type ApiStreamChunk,
	classifyProviderError,
} from "@cline/llms";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelFinishReason,
	AgentModelRequest,
} from "@cline/shared";
import { agentMessagesToMessages } from "../../runtime/config/agent-message-codec";

type ApiStreamDoneChunk = Extract<ApiStreamChunk, { type: "done" }>;

function toAgentModelEvents(chunk: ApiStreamChunk): AgentModelEvent[] {
	switch (chunk.type) {
		case "text":
			return [{ type: "text-delta", text: chunk.text }];
		case "media":
			return [{ type: "media", media: chunk.media }];
		case "reasoning":
			// Thought signatures are read as `metadata.thoughtSignature` by
			// downstream adapters (see ai-sdk format), so surface it there.
			return [
				{
					type: "reasoning-delta",
					text: chunk.reasoning,
					metadata: chunk.signature
						? { thoughtSignature: chunk.signature, details: chunk.details }
						: { details: chunk.details },
				},
			];
		case "tool_calls": {
			const fn = chunk.tool_call.function;
			const args = fn.arguments;
			return [
				{
					type: "tool-call-delta",
					toolCallId: chunk.tool_call.call_id ?? fn.id,
					toolName: fn.name,
					inputText: typeof args === "string" ? args : undefined,
					input: typeof args === "string" ? undefined : args,
					// Preserve the thought signature so it isn't dropped downstream.
					...(chunk.signature
						? { metadata: { thoughtSignature: chunk.signature } }
						: {}),
				},
			];
		}
		case "usage":
			return [
				{
					type: "usage",
					usage: {
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
						reasoningTokenCount: chunk.thoughtsTokenCount,
						totalCost: chunk.totalCost,
					},
				},
			];
		case "done":
			// `createMessage` streams typically end by returning; a "done" chunk is
			// optional. Map it to a finish event so the runtime sees a terminal
			// signal even when the handler emits one explicitly.
			return [
				{
					type: "finish",
					reason: doneFinishReason(chunk),
					error: chunk.error,
					// Handlers report failures as an already-flattened message, so
					// classification works from the text alone here. Keeps registered
					// handlers (e.g. VS Code LM) eligible for the runtime's
					// context-overflow recovery.
					...(chunk.error
						? { errorClass: classifyProviderError(chunk.error) }
						: {}),
				},
			];
		default:
			return [];
	}
}

function doneFinishReason(chunk: ApiStreamDoneChunk): AgentModelFinishReason {
	if (chunk.success === false) {
		return "error";
	}
	if (
		chunk.incompleteReason === "max_output_tokens" ||
		chunk.incompleteReason === "max-tokens"
	) {
		return "max-tokens";
	}
	return "stop";
}

/**
 * Resolves the `ApiHandler` to delegate to. A function is supported (and may be
 * async) so handler construction can be deferred to the first `stream` call —
 * which is required for providers registered via `registerAsyncHandler`.
 */
export type ApiHandlerSource =
	| ApiHandler
	| (() => ApiHandler | Promise<ApiHandler>);

/**
 * Build an `AgentModel` that delegates to a registered `ApiHandler`.
 */
export function createAgentModelFromApiHandler(
	source: ApiHandlerSource,
): AgentModel {
	return {
		async *stream(request: AgentModelRequest): AsyncGenerator<AgentModelEvent> {
			let sawFinish = false;
			let sawToolCall = false;
			try {
				// Resolving the handler (e.g. `createHandlerAsync`) can reject — for
				// instance when the host API is unavailable at stream time — so it
				// happens inside the try block to be reported as a terminal finish.
				const handler = typeof source === "function" ? await source() : source;

				// Forward the abort signal so cancellation reaches the handler.
				handler.setAbortSignal?.(request.signal);

				const messages = agentMessagesToMessages(request.messages);
				const tools = request.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				}));

				for await (const chunk of handler.createMessage(
					request.systemPrompt ?? "",
					messages,
					tools,
				)) {
					for (const event of toAgentModelEvents(chunk)) {
						if (event.type === "finish") {
							sawFinish = true;
						} else if (event.type === "tool-call-delta") {
							sawToolCall = true;
						}
						yield event;
					}
				}
				if (!sawFinish) {
					// Terminating with tool calls is a tool-calls turn (matching the
					// gateway/AI-SDK adapters); otherwise a normal stop.
					yield {
						type: "finish",
						reason: sawToolCall ? "tool-calls" : "stop",
					};
				}
			} catch (error) {
				if (!sawFinish) {
					const aborted = request.signal?.aborted === true;
					yield {
						type: "finish",
						reason: aborted ? "aborted" : "error",
						error: error instanceof Error ? error.message : String(error),
						// Classify while the raw error is still structured — the
						// message alone can hide the provider's detail (status codes,
						// response bodies). Without this, an overflow rejection from a
						// registered handler would never reach recovery.
						...(aborted ? {} : { errorClass: classifyProviderError(error) }),
					};
				}
			}
		},
	};
}
