/**
 * XML tool calling for models without reliable native function calling.
 *
 * The legacy Cline extension drove tools through XML tags in plain assistant
 * text — a format that weak/local models handle far better than native tool
 * schemas. This plugin recreates that mode on the SDK runtime as a pure
 * translation shim at the model boundary:
 *
 * - A registered rule adds the static XML "TOOL USE" instructions to the
 *   system prompt.
 * - `beforeModel` strips the native tool schemas from the provider request,
 *   injects per-turn "TOOL DOCUMENTATION" (generated from the live tool
 *   registry) into the provider-bound first user message, and rewrites prior
 *   tool calls/results in history into the XML wire format.
 * - `afterModel` parses XML tool uses out of the assistant's text and
 *   replaces the message with one carrying native `tool-call` parts.
 *
 * Everything downstream — approval hooks, tool executors, completion tools,
 * events, persistence — sees ordinary native tool calls. Internal session
 * state stays in native form; only the provider-bound request is translated.
 */

import type { AgentPlugin } from "@cline/core";
import {
	buildXmlToolDocs,
	coerceToolInput,
	formatToolResultText,
	parseAssistantXml,
	serializeToolCallXml,
	toXmlToolSpecs,
	XML_TOOL_CALLING_RULE,
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
): RuntimeMessage[] {
	return messages.map((message) => {
		const hasToolPart = message.content.some(
			(part) => part.type === "tool-call" || part.type === "tool-result",
		);
		if (!hasToolPart) {
			return message;
		}
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
}

// ---------------------------------------------------------------------------
// Assistant text -> native tool-call parts
// ---------------------------------------------------------------------------

function convertAssistantXml(
	message: AfterModelContext["assistantMessage"],
	specs: ReadonlyMap<string, XmlToolSpec>,
): AfterModelContext["assistantMessage"] | undefined {
	const parsedParts = message.content.map((part) =>
		part.type === "text" ? parseAssistantXml(part.text, specs) : undefined,
	);
	const candidates = parsedParts.flatMap((blocks, partIndex) =>
		(blocks ?? [])
			.filter((block) => block.type === "tool_use")
			.map((block) => ({ block, partIndex })),
	);
	const candidate = candidates[0];
	const candidatePart = candidate && message.content[candidate.partIndex];
	if (
		candidates.length !== 1 ||
		!candidate ||
		candidatePart?.type !== "text" ||
		candidate.block.partial ||
		!specs.has(candidate.block.name) ||
		message.content
			.slice(candidate.partIndex + 1)
			.some((part) =>
				part.type === "text" ? part.text.trim().length > 0 : true,
			) ||
		!isExecutableXmlCall(candidatePart.text, candidate.block.raw)
	) {
		return undefined;
	}

	const content: RuntimeMessagePart[] = [];
	let converted = false;
	for (const [partIndex, part] of message.content.entries()) {
		if (part.type !== "text") {
			content.push(part);
			continue;
		}
		for (const block of parsedParts[partIndex] ?? []) {
			if (block.type === "text") {
				content.push({ type: "text", text: block.text });
				continue;
			}
			const spec = specs.get(block.name);
			if (block.partial || !spec) {
				// Unclosed tool use (truncation or malformed XML): keep the raw
				// source as text rather than executing a half-parsed call.
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
// Per-turn tool documentation, injected into the provider-bound messages
// ---------------------------------------------------------------------------

/**
 * Prepend the TOOL DOCUMENTATION block to the first user message of the
 * provider-bound copy. The docs cannot live in the registered rule because
 * rules are resolved before the effective tool set (mode filtering, tool
 * policies, other plugins' tools) is knowable, and the set can change
 * between runs — `request.tools` in `beforeModel` is the only accurate
 * per-turn source.
 */
function injectToolDocs(
	messages: readonly RuntimeMessage[],
	docs: string,
): RuntimeMessage[] {
	const docsPart: RuntimeMessagePart = {
		type: "text",
		text: `${docs}\n\n====\n`,
	};
	const firstUserIndex = messages.findIndex(
		(message) => message.role === "user",
	);
	return messages.map((message, index) =>
		index === firstUserIndex
			? { ...message, content: [docsPart, ...message.content] }
			: message,
	);
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const plugin: AgentPlugin = {
	name: "xml-tool-calling",
	manifest: {
		capabilities: ["hooks", "rules"],
	},
	setup(api) {
		api.registerRule({
			id: "xml-tool-calling:instructions",
			source: "xml-tool-calling",
			content: XML_TOOL_CALLING_RULE,
		});
	},
	hooks: {
		beforeModel({ snapshot, request }: BeforeModelContext) {
			if (request.tools.length === 0) {
				toolSpecsByAgent.delete(snapshot.agentId);
				return undefined;
			}
			const specs = toXmlToolSpecs(request.tools);
			toolSpecsByAgent.set(snapshot.agentId, specs);
			const messages = injectToolDocs(
				rewriteHistoryForXml(request.messages),
				buildXmlToolDocs(specs),
			);
			return { tools: [], messages };
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
