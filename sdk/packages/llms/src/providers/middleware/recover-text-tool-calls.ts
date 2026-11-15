// LanguageModelV4 middleware that recovers tool calls a model wrote into its
// text output instead of the structured `tool_calls` channel.
//
// Background: some local models (notably Qwen 2.5 Coder served by Ollama)
// declare the `tools` capability but, depending on the chat template, answer
// with the call as plain assistant text, e.g.
//
//   {"name": "read_file", "arguments": {"path": "a.ts"}}
//
// Ollama then returns it in `message.content` with no `message.tool_calls`,
// so the AI SDK sees an ordinary text turn: the raw JSON is shown to the user
// and the tool never runs (cline/cline#14453).
//
// This middleware only fires when the whole text block (optionally wrapped in
// a Markdown code fence) is a JSON tool call — or an array of them — whose
// `name` matches a function tool offered in the request. Anything else,
// including prose that merely contains JSON, is passed through untouched.
//
// Streaming: text that does not start like JSON streams through live. A text
// block that starts with `{`, `[` or a code fence is buffered until it ends,
// then either converted to `tool-call` parts or flushed unchanged.

import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Content,
	LanguageModelV4Middleware,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

interface RecoveredToolCall {
	toolName: string;
	input: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripCodeFence(text: string): string {
	const match = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i);
	return match ? match[1] : text;
}

function toRecoveredCall(
	value: unknown,
	toolNames: ReadonlySet<string>,
): RecoveredToolCall | undefined {
	if (!isRecord(value) || typeof value.name !== "string") {
		return undefined;
	}
	if (!toolNames.has(value.name)) {
		return undefined;
	}
	let args: unknown = value.arguments ?? value.parameters ?? {};
	if (typeof args === "string") {
		try {
			args = JSON.parse(args);
		} catch {
			return undefined;
		}
	}
	if (!isRecord(args)) {
		return undefined;
	}
	return { toolName: value.name, input: JSON.stringify(args) };
}

/**
 * Parse a text block that consists solely of JSON tool call(s) for tools in
 * `toolNames`. Returns `undefined` when the text is anything else.
 */
export function parseTextToolCalls(
	text: string,
	toolNames: ReadonlySet<string>,
): RecoveredToolCall[] | undefined {
	if (toolNames.size === 0) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripCodeFence(text.trim()));
	} catch {
		return undefined;
	}
	const candidates = Array.isArray(parsed) ? parsed : [parsed];
	if (candidates.length === 0) {
		return undefined;
	}
	const calls: RecoveredToolCall[] = [];
	for (const candidate of candidates) {
		const call = toRecoveredCall(candidate, toolNames);
		if (!call) {
			return undefined;
		}
		calls.push(call);
	}
	return calls;
}

function functionToolNames(
	params: LanguageModelV4CallOptions,
): ReadonlySet<string> {
	const names = new Set<string>();
	for (const tool of params.tools ?? []) {
		if (tool.type === "function") {
			names.add(tool.name);
		}
	}
	return names;
}

function looksLikeJsonStart(text: string): boolean {
	return /^[\s]*[{[`]/.test(text);
}

let callCounter = 0;
function nextToolCallId(): string {
	callCounter += 1;
	return `text-tool-call-${Date.now().toString(36)}-${callCounter}`;
}

export const recoverTextToolCallsMiddleware: LanguageModelV4Middleware = {
	specificationVersion: "v4",

	wrapGenerate: async ({ doGenerate, params }) => {
		const result = await doGenerate();
		const toolNames = functionToolNames(params);
		if (toolNames.size === 0) {
			return result;
		}
		const hasToolCall = result.content.some(
			(part) => part.type === "tool-call",
		);
		const textParts = result.content.filter((part) => part.type === "text");
		if (hasToolCall || textParts.length !== 1) {
			return result;
		}
		const calls = parseTextToolCalls(textParts[0].text, toolNames);
		if (!calls) {
			return result;
		}
		const content: LanguageModelV4Content[] = [];
		for (const part of result.content) {
			if (part.type !== "text") {
				content.push(part);
				continue;
			}
			for (const call of calls) {
				content.push({
					type: "tool-call",
					toolCallId: nextToolCallId(),
					toolName: call.toolName,
					input: call.input,
				});
			}
		}
		return {
			...result,
			content,
			finishReason: { ...result.finishReason, unified: "tool-calls" },
		};
	},

	wrapStream: async ({ doStream, params }) => {
		const result = await doStream();
		const toolNames = functionToolNames(params);
		if (toolNames.size === 0) {
			return result;
		}

		interface Block {
			start: LanguageModelV4StreamPart;
			text: string;
		}
		const buffered = new Map<string, Block>();
		let sawNativeToolCall = false;
		let recovered = false;
		// Block ids converted to tool calls (the Ollama provider can emit an empty
		// trailing `text-delta` after `text-end` for the same id).
		const converted = new Set<string>();

		const flush = (
			id: string,
			controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
		) => {
			const block = buffered.get(id);
			if (!block) {
				return;
			}
			buffered.delete(id);
			controller.enqueue(block.start);
			if (block.text) {
				controller.enqueue({ type: "text-delta", id, delta: block.text });
			}
		};

		const stream = result.stream.pipeThrough(
			new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>(
				{
					transform(part, controller) {
						switch (part.type) {
							case "tool-call":
							case "tool-input-start":
								sawNativeToolCall = true;
								controller.enqueue(part);
								return;
							case "text-start":
								if (sawNativeToolCall) {
									controller.enqueue(part);
								} else {
									buffered.set(part.id, { start: part, text: "" });
								}
								return;
							case "text-delta": {
								const block = buffered.get(part.id);
								if (!block) {
									if (!converted.has(part.id) || part.delta) {
										controller.enqueue(part);
									}
									return;
								}
								block.text += part.delta;
								if (block.text.trim() && !looksLikeJsonStart(block.text)) {
									// Ordinary prose: stop buffering and stream live.
									flush(part.id, controller);
								}
								return;
							}
							case "text-end": {
								const block = buffered.get(part.id);
								if (!block) {
									controller.enqueue(part);
									return;
								}
								const calls = parseTextToolCalls(block.text, toolNames);
								if (!calls) {
									flush(part.id, controller);
									controller.enqueue(part);
									return;
								}
								buffered.delete(part.id);
								converted.add(part.id);
								recovered = true;
								for (const call of calls) {
									controller.enqueue({
										type: "tool-call",
										toolCallId: nextToolCallId(),
										toolName: call.toolName,
										input: call.input,
									});
								}
								return;
							}
							case "finish":
								for (const id of [...buffered.keys()]) {
									flush(id, controller);
								}
								controller.enqueue(
									recovered
										? {
												...part,
												finishReason: {
													...part.finishReason,
													unified: "tool-calls",
												},
											}
										: part,
								);
								return;
							default:
								controller.enqueue(part);
						}
					},
				},
			),
		);
		return { ...result, stream };
	},
};
