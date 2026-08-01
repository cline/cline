/**
 * XML tool-calling translation at the gateway boundary.
 *
 * For models without reliable native tool calling
 * (`GatewayStreamRequest.toolCallingMode === "xml"`), the gateway translates
 * between the runtime's native tool contract and an XML text wire format the
 * legacy Cline extension used:
 *
 * - Request: tool schemas are stripped, XML tool-use instructions plus
 *   per-turn tool documentation are appended to the system prompt, and prior
 *   native tool calls/results in history are rewritten into XML/plain text.
 * - Response: assistant text is buffered while the provider streams (reasoning
 *   and usage events pass through live), then parsed once at end of stream; a
 *   well-formed terminal tool use is emitted as a native `tool-call-delta` so
 *   everything downstream — approvals, executors, persistence, UI — sees an
 *   ordinary native tool call. Text that fails the executability gates is
 *   emitted verbatim as text.
 *
 * Deliberately non-streaming on the text channel: parsing complete text keeps
 * the parser simple and never leaks raw XML into the UI. The native path does
 * not stream partial tool-call arguments to the UI either, so tool rendering
 * is identical to native mode.
 */

import type {
	AgentMessage,
	AgentMessagePart,
	AgentModelEvent,
	GatewayStreamRequest,
} from "@cline/shared";
import { nanoid } from "nanoid";
import {
	buildXmlToolCallingPrompt,
	coerceToolInput,
	formatToolResultText,
	parseAssistantXml,
	serializeToolCallXml,
	toXmlToolSpecs,
	type XmlToolSpec,
} from "./format";

export interface XmlToolCallingTranslation {
	request: GatewayStreamRequest;
	specs: Map<string, XmlToolSpec>;
}

/**
 * Translate a gateway request into the XML wire format, or return undefined
 * when the request does not opt in (or has no tools to translate).
 */
export function translateXmlToolCallingRequest(
	request: GatewayStreamRequest,
): XmlToolCallingTranslation | undefined {
	if (request.toolCallingMode !== "xml" || !request.tools?.length) {
		return undefined;
	}
	const specs = toXmlToolSpecs(request.tools);
	const xmlPrompt = buildXmlToolCallingPrompt(specs);
	return {
		specs,
		request: {
			...request,
			tools: undefined,
			systemPrompt: request.systemPrompt
				? `${request.systemPrompt}\n\n${xmlPrompt}`
				: xmlPrompt,
			messages: rewriteHistoryForXml(request.messages),
		},
	};
}

/**
 * Rewrite native tool parts in the provider-bound history into the XML wire
 * format the model was instructed to produce. Tool-result messages carry the
 * "tool" role, which providers reject when no tool schemas are in the
 * request — they become user messages, matching how the legacy extension fed
 * results back.
 */
export function rewriteHistoryForXml(
	messages: readonly AgentMessage[],
): AgentMessage[] {
	return messages.map((message) => {
		const hasToolPart = message.content.some(
			(part) => part.type === "tool-call" || part.type === "tool-result",
		);
		if (!hasToolPart) {
			return message;
		}
		const content: AgentMessagePart[] = message.content.map((part) => {
			if (part.type === "tool-call") {
				return {
					type: "text",
					text: serializeToolCallXml(part.toolName, part.input),
				};
			}
			if (part.type === "tool-result") {
				return {
					type: "text",
					text: formatToolResultText(part.toolName, part.output, part.isError),
				};
			}
			return part;
		});
		const role = message.role === "tool" ? "user" : message.role;
		return { ...message, role, content };
	});
}

// ---------------------------------------------------------------------------
// Executability gates (ported from the legacy hardening work)
// ---------------------------------------------------------------------------

function isInsideMarkdownFence(text: string): boolean {
	let activeFence: { marker: string; length: number } | undefined;
	for (const line of text.split(/\r?\n/)) {
		const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (!match) continue;
		const run = match[1];
		if (!run) continue;
		if (!activeFence) {
			activeFence = { marker: run[0] ?? "", length: run.length };
		} else if (
			run[0] === activeFence.marker &&
			run.length >= activeFence.length &&
			line.slice(match[0].length).trim().length === 0
		) {
			activeFence = undefined;
		}
	}
	return activeFence !== undefined;
}

/**
 * A tool use is executable only when it terminates the message, starts at
 * (or near) the beginning of a line, and is not inside an open markdown
 * fence — XML that is quoted inline, fenced as an example, or followed by
 * more prose stays plain text.
 */
function isExecutableXmlCall(text: string, raw: string): boolean {
	const callStart = text.indexOf(raw);
	if (callStart === -1 || text.slice(callStart + raw.length).trim()) {
		return false;
	}
	const lineStart = text.lastIndexOf("\n", callStart - 1) + 1;
	return (
		/^ {0,3}$/.test(text.slice(lineStart, callStart)) &&
		!isInsideMarkdownFence(text.slice(0, callStart))
	);
}

interface ExecutableXmlCall {
	toolName: string;
	input: Record<string, unknown>;
	/** Text preceding the tool call, trimmed of trailing whitespace. */
	prose: string;
}

/**
 * Parse the assistant's complete text and return the single executable tool
 * use, or undefined when the text should stay plain text (no tool tags,
 * multiple/partial/unknown calls, or a call that fails the position gates).
 */
export function extractExecutableXmlCall(
	text: string,
	specs: ReadonlyMap<string, XmlToolSpec>,
): ExecutableXmlCall | undefined {
	const blocks = parseAssistantXml(text, specs);
	const toolBlocks = blocks.filter((block) => block.type === "tool_use");
	const candidate = toolBlocks[0];
	if (
		toolBlocks.length !== 1 ||
		!candidate ||
		candidate.partial ||
		blocks.at(-1) !== candidate ||
		!isExecutableXmlCall(text, candidate.raw)
	) {
		return undefined;
	}
	const spec = specs.get(candidate.name);
	if (!spec) {
		return undefined;
	}
	return {
		toolName: candidate.name,
		input: coerceToolInput(candidate.params, spec),
		prose: text.slice(0, text.indexOf(candidate.raw)).trimEnd(),
	};
}

// ---------------------------------------------------------------------------
// Stream translation
// ---------------------------------------------------------------------------

/**
 * Buffer the provider's text deltas, pass everything else through live, and
 * at end of stream emit either prose + a native tool call (when the text
 * carries exactly one well-formed terminal tool use) or the raw text
 * verbatim. The finish reason becomes `"tool-calls"` when a call was
 * converted so the runtime treats the turn like any native tool turn.
 */
export async function* translateXmlToolCallingStream(
	inner: AsyncIterable<AgentModelEvent>,
	translation: XmlToolCallingTranslation,
): AsyncIterable<AgentModelEvent> {
	let text = "";
	let finishEvent: Extract<AgentModelEvent, { type: "finish" }> | undefined;

	for await (const event of inner) {
		if (event.type === "text-delta") {
			text += event.text;
			continue;
		}
		if (event.type === "finish") {
			finishEvent = event;
			continue;
		}
		yield event;
	}

	const call = text
		? extractExecutableXmlCall(text, translation.specs)
		: undefined;
	if (call) {
		if (call.prose) {
			yield { type: "text-delta", text: call.prose };
		}
		yield {
			type: "tool-call-delta",
			toolCallId: `xml_${nanoid()}`,
			toolName: call.toolName,
			input: call.input,
			inputText: JSON.stringify(call.input),
			metadata: {
				toolSource: {
					providerId: translation.request.providerId,
					modelId: translation.request.modelId,
					executionMode: "runtime",
					wireFormat: "xml",
				},
			},
		};
	} else if (text) {
		yield { type: "text-delta", text };
	}

	if (finishEvent) {
		yield call && finishEvent.reason !== "aborted"
			? { ...finishEvent, reason: "tool-calls" }
			: finishEvent;
	} else {
		yield { type: "finish", reason: call ? "tool-calls" : "stop" };
	}
}
