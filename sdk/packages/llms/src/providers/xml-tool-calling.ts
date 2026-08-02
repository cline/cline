// XML tool calling (`GatewayStreamRequest.toolCallingMode === "xml"`) for
// models without reliable native tool calling.
//
// The translation is delegated to `@ai-sdk-tool/parser`'s morph-XML middleware
// (the same library the OpenCode ecosystem uses for models without native
// tool support), applied at the AI SDK model boundary via `wrapLanguageModel`:
//
// - Request: the middleware strips native tool schemas from the call options,
//   renders per-tool docs + XML formatting rules into the system prompt, and
//   serializes prior tool-call/tool-result turns into the text wire format.
// - Response: assistant text streams through live; tool calls written as
//   `<tool_name><param>value</param></tool_name>` are incrementally parsed
//   into native `tool-input-start/-delta/-end` + `tool-call` stream parts
//   (with schema-aware argument coercion), so everything downstream —
//   approvals, executors, persistence, UI — sees ordinary native tool calls.
//   Malformed tool markup is suppressed from the text stream by default
//   rather than leaking raw XML into the chat.
//
// Everything above the model (gateway, runtime, hosts) keeps speaking the
// native tool contract; the only signal is `toolCallingMode` on the request.

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { morphXmlToolMiddleware } from "@ai-sdk-tool/parser";
import type { GatewayToolCallingMode } from "@cline/shared";
import { wrapLanguageModel } from "ai";

/**
 * Wrap `model` with the XML tool-calling middleware when the request opted
 * into `toolCallingMode: "xml"`; otherwise return the model unchanged.
 */
export function applyToolCallingMode<Model>(
	model: Model,
	toolCallingMode: GatewayToolCallingMode | undefined,
): Model {
	if (toolCallingMode !== "xml") {
		return model;
	}
	return wrapLanguageModel({
		model: model as LanguageModelV3,
		middleware: morphXmlToolMiddleware,
	}) as Model;
}
