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

import type { ApiHandler, ApiStreamChunk } from "@cline/llms";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
} from "@cline/shared";
import { agentMessagesToMessages } from "../../runtime/config/agent-message-codec";

function toAgentModelEvents(chunk: ApiStreamChunk): AgentModelEvent[] {
	switch (chunk.type) {
		case "text":
			return [{ type: "text-delta", text: chunk.text }];
		case "reasoning":
			return [
				{
					type: "reasoning-delta",
					text: chunk.reasoning,
					metadata: chunk.signature
						? { signature: chunk.signature, details: chunk.details }
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
					reason: chunk.success === false ? "error" : "stop",
					error: chunk.error,
				},
			];
		default:
			return [];
	}
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
			const handler = typeof source === "function" ? await source() : source;

			// Forward the abort signal so cancellation reaches the handler.
			handler.setAbortSignal?.(request.signal);

			const messages = agentMessagesToMessages(request.messages);
			const tools = request.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));

			let sawFinish = false;
			try {
				for await (const chunk of handler.createMessage(
					request.systemPrompt ?? "",
					messages,
					tools,
				)) {
					for (const event of toAgentModelEvents(chunk)) {
						if (event.type === "finish") {
							sawFinish = true;
						}
						yield event;
					}
				}
				if (!sawFinish) {
					yield { type: "finish", reason: "stop" };
				}
			} catch (error) {
				if (!sawFinish) {
					yield {
						type: "finish",
						reason: request.signal?.aborted ? "aborted" : "error",
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		},
	};
}
