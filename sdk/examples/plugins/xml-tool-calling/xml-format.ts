/**
 * Pure XML tool-calling primitives: prompt generation, assistant-message
 * parsing, and provider-bound serialization.
 *
 * This module is dependency-free on purpose — the types below are structural
 * mirrors of the `@cline/core` agent contracts, so the plugin can pass its
 * runtime values straight in while the parser stays unit-testable in
 * isolation.
 *
 * The parser is a port of the legacy Cline extension's
 * `parseAssistantMessageV2` (apps/vscode/src/core/assistant-message/),
 * generalized from a fixed tool list to schema-derived tool and parameter
 * names.
 */

// ---------------------------------------------------------------------------
// Tool specs (derived from JSON Schema tool definitions)
// ---------------------------------------------------------------------------

/** Structural mirror of `AgentToolDefinition`. */
export interface XmlToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	lifecycle?: {
		completesRun?: boolean;
	};
}

export interface XmlToolParamSpec {
	name: string;
	type: string;
	description?: string;
	required: boolean;
}

export interface XmlToolSpec {
	name: string;
	description: string;
	params: XmlToolParamSpec[];
	completesRun: boolean;
}

function schemaTypeOf(propSchema: unknown): string {
	if (!propSchema || typeof propSchema !== "object") {
		return "string";
	}
	const record = propSchema as Record<string, unknown>;
	const type = record.type;
	if (typeof type === "string") {
		return type;
	}
	if (Array.isArray(type)) {
		const first = type.find(
			(entry) => typeof entry === "string" && entry !== "null",
		);
		if (typeof first === "string") {
			return first;
		}
	}
	if (record.enum) {
		return "string";
	}
	return "string";
}

function schemaDescriptionOf(propSchema: unknown): string | undefined {
	if (!propSchema || typeof propSchema !== "object") {
		return undefined;
	}
	const record = propSchema as Record<string, unknown>;
	const parts: string[] = [];
	if (typeof record.description === "string" && record.description.trim()) {
		parts.push(record.description.trim());
	}
	if (Array.isArray(record.enum)) {
		parts.push(
			`One of: ${record.enum.map((v) => JSON.stringify(v)).join(", ")}.`,
		);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

export function toXmlToolSpec(tool: XmlToolDefinition): XmlToolSpec {
	const schema = tool.inputSchema ?? {};
	const properties =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, unknown>)
			: {};
	const required = new Set(
		Array.isArray(schema.required)
			? schema.required.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: [],
	);
	return {
		name: tool.name,
		description: tool.description,
		params: Object.entries(properties).map(([name, propSchema]) => ({
			name,
			type: schemaTypeOf(propSchema),
			description: schemaDescriptionOf(propSchema),
			required: required.has(name),
		})),
		completesRun: tool.lifecycle?.completesRun === true,
	};
}

export function toXmlToolSpecs(
	tools: readonly XmlToolDefinition[],
): Map<string, XmlToolSpec> {
	const specs = new Map<string, XmlToolSpec>();
	for (const tool of tools) {
		specs.set(tool.name, toXmlToolSpec(tool));
	}
	return specs;
}

// ---------------------------------------------------------------------------
// System prompt section
// ---------------------------------------------------------------------------

function paramPlaceholder(param: XmlToolParamSpec): string {
	switch (param.type) {
		case "number":
		case "integer":
			return "42";
		case "boolean":
			return "true or false";
		case "array":
			return '["item1", "item2"] (a JSON array)';
		case "object":
			return '{"key": "value"} (a JSON object)';
		default:
			return `${param.name.replaceAll("_", " ")} here`;
	}
}

function paramTypeLabel(param: XmlToolParamSpec): string {
	switch (param.type) {
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return "true or false";
		case "array":
			return "JSON array";
		case "object":
			return "JSON object";
		default:
			return "text";
	}
}

function buildToolDoc(spec: XmlToolSpec): string {
	const lines: string[] = [
		`## ${spec.name}`,
		`Description: ${spec.description}`,
	];
	if (spec.params.length === 0) {
		lines.push("Parameters: none");
		lines.push("Usage:", `<${spec.name}>`, `</${spec.name}>`);
		return lines.join("\n");
	}
	lines.push("Parameters:");
	for (const param of spec.params) {
		const requirement = param.required ? "required" : "optional";
		const description = param.description ? ` ${param.description}` : "";
		lines.push(
			`- ${param.name}: (${requirement}, ${paramTypeLabel(param)})${description}`,
		);
	}
	lines.push("Usage:", `<${spec.name}>`);
	for (const param of spec.params) {
		lines.push(`<${param.name}>${paramPlaceholder(param)}</${param.name}>`);
	}
	lines.push(`</${spec.name}>`);
	return lines.join("\n");
}

/**
 * Static XML tool-use instructions, registered as a system prompt rule via
 * `api.registerRule`. Adapted from the legacy Cline extension's XML tool-use
 * prompt. The per-tool documentation is dynamic (the tool set varies per
 * turn) and travels separately — see `buildXmlToolDocs`.
 */
export const XML_TOOL_CALLING_RULE = `====

TOOL USE

You do NOT have access to native function calling. Instead, you use tools by writing XML-style tags directly in your plain-text reply. Tool uses are parsed from your reply and executed by the user's system; you receive each result in the next user message. The available tools are documented under "TOOL DOCUMENTATION" in the first user message.

# Tool Use Formatting

A tool use is formatted with the tool name as the outer XML tag and each parameter inside its own tag:

<tool_name>
<parameter1_name>value 1</parameter1_name>
<parameter2_name>value 2</parameter2_name>
</tool_name>

Always use the actual tool name as the XML tag name, exactly as documented. Do not wrap tool calls in code fences or JSON. Parameter values are plain text between the tags; for parameters typed as JSON array or JSON object, write valid JSON between the tags.

# Tool Use Guidelines

1. Use exactly ONE tool per message, at the end of your reply.
2. Wait for the tool result in the next message before continuing. NEVER assume a tool succeeded.
3. If a tool result reports an error, address it before retrying.
4. Only use tools listed in TOOL DOCUMENTATION.`;

/**
 * The dynamic "TOOL DOCUMENTATION" block generated from the live tool
 * registry each turn and injected into the provider-bound first user
 * message. Kept out of the rule because rules are resolved before the
 * effective tool set (mode filtering, policies, other plugins' tools) is
 * knowable, and the set can change between runs.
 */
export function buildXmlToolDocs(
	specs: ReadonlyMap<string, XmlToolSpec>,
): string {
	const completionTools = [...specs.values()]
		.filter((spec) => spec.completesRun)
		.map((spec) => spec.name);
	const docs = [...specs.values()].map(buildToolDoc).join("\n\n");
	const completionGuidance =
		completionTools.length > 0
			? `When the task is fully complete, use ${completionTools
					.map((name) => `\`${name}\``)
					.join(" or ")} to finish.`
			: "When the task is fully complete, reply in plain text without any tool tags.";
	return `TOOL DOCUMENTATION

These are the tools currently available to you. Invoke them with XML tags as described in the TOOL USE section of your instructions.

${docs}

${completionGuidance}`;
}

// ---------------------------------------------------------------------------
// Parsing assistant text into tool uses
// ---------------------------------------------------------------------------

export interface ParsedTextBlock {
	type: "text";
	text: string;
}

export interface ParsedToolUseBlock {
	type: "tool_use";
	name: string;
	params: Record<string, string>;
	/** True when the input ended before the tool's closing tag. */
	partial: boolean;
	/** Original source slice for this tool use (open tag through close tag). */
	raw: string;
}

export type ParsedAssistantBlock = ParsedTextBlock | ParsedToolUseBlock;

interface OpenToolState {
	name: string;
	spec: XmlToolSpec;
	params: Record<string, string>;
	/** Absolute index of `<` of the opening tag. */
	openTagStart: number;
	/** Absolute index just past the opening tag. */
	contentStart: number;
	/** Param name -> absolute index just past its consumed closing tag. */
	paramCloseEnds: Map<string, number>;
}

/**
 * Recover parameter values whose text contains their own closing tag (the
 * classic case: file content containing `</content>`). Sequential parsing
 * consumes the first closing tag; when another closing occurrence exists
 * later in the tool body, re-extract the value spanning from the first
 * opening tag to the last closing tag — the legacy parser's `write_to_file`
 * special case, generalized to every captured parameter.
 */
function recoverTruncatedParams(
	text: string,
	tool: OpenToolState,
	contentEnd: number,
): void {
	const contentSlice = text.slice(tool.contentStart, contentEnd);
	for (const [paramName, consumedEnd] of tool.paramCloseEnds) {
		const closeTag = `</${paramName}>`;
		const extraClose = text.indexOf(closeTag, consumedEnd);
		if (extraClose === -1 || extraClose >= contentEnd) {
			continue;
		}
		const openTag = `<${paramName}>`;
		const openIndex = contentSlice.indexOf(openTag);
		const lastClose = contentSlice.lastIndexOf(closeTag);
		if (openIndex === -1 || lastClose <= openIndex) {
			continue;
		}
		tool.params[paramName] = contentSlice
			.slice(openIndex + openTag.length, lastClose)
			.trim();
	}
}

export function parseAssistantXml(
	text: string,
	specs: ReadonlyMap<string, XmlToolSpec>,
): ParsedAssistantBlock[] {
	const blocks: ParsedAssistantBlock[] = [];
	const toolOpenTags = new Map<string, XmlToolSpec>();
	for (const spec of specs.values()) {
		toolOpenTags.set(`<${spec.name}>`, spec);
	}

	let textStart = 0;
	let tool: OpenToolState | undefined;
	let paramName: string | undefined;
	let paramValueStart = 0;

	const len = text.length;
	for (let i = 0; i < len; i++) {
		// Inside a parameter: only its closing tag matters.
		if (tool && paramName) {
			const closeTag = `</${paramName}>`;
			if (
				i >= closeTag.length - 1 &&
				text.startsWith(closeTag, i - closeTag.length + 1)
			) {
				tool.params[paramName] = text
					.slice(paramValueStart, i - closeTag.length + 1)
					.trim();
				tool.paramCloseEnds.set(paramName, i + 1);
				paramName = undefined;
			} else {
				continue;
			}
		}

		// Inside a tool body: look for a parameter opening tag or the tool close.
		if (tool && !paramName) {
			let startedParam = false;
			for (const param of tool.spec.params) {
				const openTag = `<${param.name}>`;
				if (
					i >= openTag.length - 1 &&
					text.startsWith(openTag, i - openTag.length + 1)
				) {
					paramName = param.name;
					paramValueStart = i + 1;
					startedParam = true;
					break;
				}
			}
			if (startedParam) {
				continue;
			}

			const toolCloseTag = `</${tool.name}>`;
			if (
				i >= toolCloseTag.length - 1 &&
				text.startsWith(toolCloseTag, i - toolCloseTag.length + 1)
			) {
				const contentEnd = i - toolCloseTag.length + 1;
				recoverTruncatedParams(text, tool, contentEnd);
				blocks.push({
					type: "tool_use",
					name: tool.name,
					params: tool.params,
					partial: false,
					raw: text.slice(tool.openTagStart, i + 1),
				});
				tool = undefined;
				textStart = i + 1;
			}
			continue;
		}

		// In plain text: look for a tool opening tag.
		for (const [openTag, spec] of toolOpenTags) {
			if (
				i >= openTag.length - 1 &&
				text.startsWith(openTag, i - openTag.length + 1)
			) {
				const tagStart = i - openTag.length + 1;
				const leadingText = text.slice(textStart, tagStart).trim();
				if (leadingText.length > 0) {
					blocks.push({ type: "text", text: leadingText });
				}
				tool = {
					name: spec.name,
					spec,
					params: {},
					openTagStart: tagStart,
					contentStart: i + 1,
					paramCloseEnds: new Map(),
				};
				break;
			}
		}
	}

	// Finalize whatever is still open at end of input.
	if (tool && paramName) {
		tool.params[paramName] = text.slice(paramValueStart).trim();
	}
	if (tool) {
		blocks.push({
			type: "tool_use",
			name: tool.name,
			params: tool.params,
			partial: true,
			raw: text.slice(tool.openTagStart),
		});
	} else {
		const trailingText = text.slice(textStart).trim();
		if (trailingText.length > 0) {
			blocks.push({ type: "text", text: trailingText });
		}
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Coercing parsed string params into schema-typed tool input
// ---------------------------------------------------------------------------

/**
 * Coerce flat string parameter values into the types declared by the tool's
 * schema. Values that fail coercion are passed through as raw strings so the
 * tool's own input validation produces the error the model gets to react to.
 */
export function coerceToolInput(
	params: Record<string, string>,
	spec: XmlToolSpec,
): Record<string, unknown> {
	const types = new Map(spec.params.map((param) => [param.name, param.type]));
	const input: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(params)) {
		switch (types.get(key)) {
			case "number":
			case "integer": {
				const value = Number(raw);
				input[key] = Number.isNaN(value) ? raw : value;
				break;
			}
			case "boolean":
				input[key] = raw === "true" ? true : raw === "false" ? false : raw;
				break;
			case "array":
			case "object":
				try {
					input[key] = JSON.parse(raw);
				} catch {
					input[key] = raw;
				}
				break;
			default:
				input[key] = raw;
		}
	}
	return input;
}

// ---------------------------------------------------------------------------
// Serializing native tool parts back into XML/plain text for the provider
// ---------------------------------------------------------------------------

function formatParamValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
}

/** Render a native tool call as the XML the model was instructed to write. */
export function serializeToolCallXml(toolName: string, input: unknown): string {
	const record =
		input && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	const params = Object.entries(record)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `<${key}>${formatParamValue(value)}</${key}>`);
	return [`<${toolName}>`, ...params, `</${toolName}>`].join("\n");
}

/** Render a native tool result as the plain-text user message the model reads. */
export function formatToolResultText(
	toolName: string,
	output: unknown,
	isError: boolean | undefined,
): string {
	const body =
		typeof output === "string" ? output : JSON.stringify(output, null, 2);
	const label = isError ? "Error" : "Result";
	return `[${toolName}] ${label}:\n${body ?? ""}`;
}
