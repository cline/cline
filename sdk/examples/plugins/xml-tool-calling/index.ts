/**
 * XML tool calling for models without reliable native function calling.
 *
 * The legacy Cline extension drove tools through XML tags in plain assistant
 * text — a format that weak/local models handle far better than native tool
 * schemas. This plugin recreates that mode on the SDK runtime as a pure
 * translation shim at the model boundary:
 *
 * - `beforeModel` strips the native tool schemas from the provider request,
 *   appends an XML "TOOL USE" section (generated from the live tool
 *   registry) to the system prompt, and rewrites prior tool calls/results in
 *   history into the XML wire format.
 * - `afterModel` parses XML tool uses out of the assistant's text and
 *   replaces the message with one carrying native `tool-call` parts.
 *
 * Everything downstream — approval hooks, tool executors, completion tools,
 * events, persistence — sees ordinary native tool calls. Internal session
 * state stays in native form; only the provider-bound request is translated.
 */

import type { AgentPlugin } from "@cline/core";
import {
	buildXmlToolPromptSection,
	coerceToolInput,
	formatToolResultText,
	parseAssistantXml,
	serializeToolCallXml,
	toXmlToolSpecs,
	type XmlToolSpec,
} from "./xml-format.ts";

// ---------------------------------------------------------------------------
// Runtime types, derived structurally from the plugin contract
// ---------------------------------------------------------------------------

type RuntimeHooks = NonNullable<AgentPlugin["hooks"]>;
type BeforeModelContext = Parameters<
	NonNullable<RuntimeHooks["beforeModel"]>
>[0];
type AfterModelContext = Parameters<NonNullable<RuntimeHooks["afterModel"]>>[0];
type RuntimeMessage = BeforeModelContext["request"]["messages"][number];
type RuntimeMessagePart = RuntimeMessage["content"][number];

// ---------------------------------------------------------------------------
// Per-agent state
// ---------------------------------------------------------------------------

/**
 * Tool specs captured in `beforeModel`, keyed by agent id. `afterModel` does
 * not receive the tool list, and `beforeModel` always runs first in the same
 * turn, so the entry is guaranteed fresh when the parse step reads it.
 */
const toolSpecsByAgent = new Map<string, Map<string, XmlToolSpec>>();

let toolCallCounter = 0;
function nextToolCallId(): string {
	toolCallCounter += 1;
	return `xml_call_${toolCallCounter}`;
}

// ---------------------------------------------------------------------------
// Provider-bound history rewriting (native parts -> XML wire format)
// ---------------------------------------------------------------------------

function rewriteHistoryForXml(
	messages: readonly RuntimeMessage[],
): RuntimeMessage[] | undefined {
	let changed = false;
	const rewritten = messages.map((message) => {
		const hasToolCall = message.content.some(
			(part) => part.type === "tool-call",
		);
		const hasToolResult = message.content.some(
			(part) => part.type === "tool-result",
		);
		if (!hasToolCall && !hasToolResult) {
			return message;
		}
		changed = true;
		const content: RuntimeMessagePart[] = message.content.map((part) => {
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
		// Tool-result messages carry the "tool" role, which providers reject
		// when no tool schemas are in the request — they become user messages,
		// matching how the legacy extension fed results back.
		const role = message.role === "tool" ? "user" : message.role;
		return { ...message, role, content };
	});
	return changed ? rewritten : undefined;
}

// ---------------------------------------------------------------------------
// Assistant text -> native tool-call parts
// ---------------------------------------------------------------------------

function convertAssistantXml(
	message: AfterModelContext["assistantMessage"],
	specs: ReadonlyMap<string, XmlToolSpec>,
): AfterModelContext["assistantMessage"] | undefined {
	const content: RuntimeMessagePart[] = [];
	let converted = false;
	for (const part of message.content) {
		if (part.type !== "text") {
			content.push(part);
			continue;
		}
		for (const block of parseAssistantXml(part.text, specs)) {
			if (block.type === "text") {
				content.push({ type: "text", text: block.text });
				continue;
			}
			if (block.partial) {
				// Unclosed tool use (truncation or malformed XML): keep the raw
				// source as text rather than executing a half-parsed call.
				content.push({ type: "text", text: block.raw });
				continue;
			}
			const spec = specs.get(block.name);
			if (!spec) {
				content.push({ type: "text", text: block.raw });
				continue;
			}
			content.push({
				type: "tool-call",
				toolCallId: nextToolCallId(),
				toolName: block.name,
				input: coerceToolInput(block.params, spec),
			});
			converted = true;
		}
	}
	if (!converted) {
		return undefined;
	}
	return { ...message, content };
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const plugin: AgentPlugin = {
	name: "xml-tool-calling",
	manifest: {
		capabilities: ["hooks"],
	},
	hooks: {
		beforeModel({ snapshot, request }: BeforeModelContext) {
			const historyRewrite = rewriteHistoryForXml(request.messages);
			if (request.tools.length === 0) {
				toolSpecsByAgent.delete(snapshot.agentId);
				return historyRewrite ? { messages: historyRewrite } : undefined;
			}
			const specs = toXmlToolSpecs(request.tools);
			toolSpecsByAgent.set(snapshot.agentId, specs);
			const basePrompt = request.systemPrompt?.trim() ?? "";
			const section = buildXmlToolPromptSection(specs);
			return {
				tools: [],
				systemPrompt: basePrompt ? `${basePrompt}\n\n${section}` : section,
				...(historyRewrite ? { messages: historyRewrite } : {}),
			};
		},
		afterModel({ snapshot, assistantMessage }: AfterModelContext) {
			const specs = toolSpecsByAgent.get(snapshot.agentId);
			if (!specs || specs.size === 0) {
				return undefined;
			}
			const converted = convertAssistantXml(assistantMessage, specs);
			return converted ? { message: converted } : undefined;
		},
	},
};

export { convertAssistantXml, plugin, rewriteHistoryForXml };
export default plugin;
