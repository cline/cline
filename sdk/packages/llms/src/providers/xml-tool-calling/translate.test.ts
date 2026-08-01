import type {
	AgentMessage,
	AgentModelEvent,
	AgentToolDefinition,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	extractExecutableXmlCall,
	rewriteHistoryForXml,
	translateXmlToolCallingRequest,
	translateXmlToolCallingStream,
	type XmlToolCallingTranslation,
} from "./translate";

const TOOLS: AgentToolDefinition[] = [
	{
		name: "read_file",
		description: "Read a file from disk.",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	{
		name: "run_commands",
		description: "Run shell commands.",
		inputSchema: {
			type: "object",
			properties: {
				commands: { type: "array", items: { type: "string" } },
				background: { type: "boolean" },
			},
			required: ["commands"],
		},
	},
];

function message(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
): AgentMessage {
	return { id: `msg_${role}_${Math.random()}`, role, content, createdAt: 0 };
}

function baseRequest(
	overrides: Partial<GatewayStreamRequest> = {},
): GatewayStreamRequest {
	return {
		providerId: "ollama",
		modelId: "qwen3",
		systemPrompt: "You are Cline.",
		messages: [message("user", [{ type: "text", text: "hi" }])],
		tools: TOOLS,
		toolCallingMode: "xml",
		...overrides,
	};
}

async function collect(
	events: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const out: AgentModelEvent[] = [];
	for await (const event of events) {
		out.push(event);
	}
	return out;
}

async function* stream(
	...events: AgentModelEvent[]
): AsyncIterable<AgentModelEvent> {
	for (const event of events) {
		yield event;
	}
}

function joinText(events: readonly AgentModelEvent[]): string {
	return events
		.filter((event) => event.type === "text-delta")
		.map((event) => event.text)
		.join("");
}

function translation(): XmlToolCallingTranslation {
	const result = translateXmlToolCallingRequest(baseRequest());
	if (!result) throw new Error("expected translation");
	return result;
}

describe("translateXmlToolCallingRequest", () => {
	it("returns undefined for native mode or tool-less requests", () => {
		expect(
			translateXmlToolCallingRequest(
				baseRequest({ toolCallingMode: undefined }),
			),
		).toBeUndefined();
		expect(
			translateXmlToolCallingRequest(
				baseRequest({ toolCallingMode: "native" }),
			),
		).toBeUndefined();
		expect(
			translateXmlToolCallingRequest(baseRequest({ tools: [] })),
		).toBeUndefined();
	});

	it("strips tools and appends the XML section to the system prompt", () => {
		const result = translation();
		expect(result.request.tools).toBeUndefined();
		expect(result.request.systemPrompt).toContain("You are Cline.");
		expect(result.request.systemPrompt).toContain("TOOL USE");
		expect(result.request.systemPrompt).toContain("## read_file");
		expect(result.request.systemPrompt).toContain("## run_commands");
	});

	it("uses the XML section alone when there is no system prompt", () => {
		const result = translateXmlToolCallingRequest(
			baseRequest({ systemPrompt: undefined }),
		);
		expect(result?.request.systemPrompt?.startsWith("====")).toBe(true);
	});

	it("rewrites prior tool calls and results into the XML wire format", () => {
		const result = translateXmlToolCallingRequest(
			baseRequest({
				messages: [
					message("user", [{ type: "text", text: "read a.ts" }]),
					message("assistant", [
						{ type: "text", text: "Reading." },
						{
							type: "tool-call",
							toolCallId: "t1",
							toolName: "read_file",
							input: { path: "a.ts" },
						},
					]),
					message("tool", [
						{
							type: "tool-result",
							toolCallId: "t1",
							toolName: "read_file",
							output: "file body",
						},
					]),
				],
			}),
		);
		const [, assistant, toolResult] = result?.request.messages ?? [];
		expect(assistant?.content).toEqual([
			{ type: "text", text: "Reading." },
			{
				type: "text",
				text: "<read_file>\n<path>a.ts</path>\n</read_file>",
			},
		]);
		expect(toolResult?.role).toBe("user");
		expect(toolResult?.content).toEqual([
			{ type: "text", text: "[read_file] Result:\nfile body" },
		]);
	});
});

describe("rewriteHistoryForXml", () => {
	it("leaves tool-free messages untouched", () => {
		const original = [message("user", [{ type: "text", text: "hello" }])];
		expect(rewriteHistoryForXml(original)[0]).toBe(original[0]);
	});

	it("hoists images out of tool results instead of serializing base64", () => {
		const [rewritten] = rewriteHistoryForXml([
			message("tool", [
				{
					type: "tool-result",
					toolCallId: "t1",
					toolName: "read_files",
					output: [
						{
							query: "shot.png",
							result: [
								{ type: "text", text: "Successfully read image" },
								{ type: "image", data: "QkFTRTY0", mediaType: "image/png" },
							],
							success: true,
						},
					],
				},
			]),
		]);
		expect(rewritten?.role).toBe("user");
		const [text, image] = rewritten?.content ?? [];
		expect(text).toEqual({
			type: "text",
			text: `[read_files] Result:\n${JSON.stringify(
				[
					{
						query: "shot.png",
						result: ["Successfully read image", "[image attached]"],
						success: true,
					},
				],
				null,
				2,
			)}`,
		});
		expect(image).toEqual({
			type: "image",
			image: "QkFTRTY0",
			mediaType: "image/png",
		});
	});
});

describe("extractExecutableXmlCall", () => {
	const specs = translation().specs;

	it("extracts a terminal tool call with leading prose", () => {
		const call = extractExecutableXmlCall(
			"I'll read the file now.\n<read_file>\n<path>src/app.ts</path>\n</read_file>",
			specs,
		);
		expect(call).toEqual({
			toolName: "read_file",
			input: { path: "src/app.ts" },
			start: "I'll read the file now.\n".length,
		});
	});

	it("coerces schema-typed params", () => {
		const call = extractExecutableXmlCall(
			'<run_commands>\n<commands>["ls"]</commands>\n<background>true</background>\n</run_commands>',
			specs,
		);
		expect(call?.input).toEqual({ commands: ["ls"], background: true });
	});

	it("rejects text without tool tags", () => {
		expect(extractExecutableXmlCall("All done!", specs)).toBeUndefined();
	});

	it("rejects partial tool calls", () => {
		expect(
			extractExecutableXmlCall("<read_file>\n<path>a.ts", specs),
		).toBeUndefined();
	});

	it("runs only the first of several tool calls", () => {
		const call = extractExecutableXmlCall(
			"<read_file><path>a.ts</path></read_file>\n<read_file><path>b.ts</path></read_file>",
			specs,
		);
		expect(call?.input).toEqual({ path: "a.ts" });
	});

	it("runs a call followed by trailing prose", () => {
		const call = extractExecutableXmlCall(
			"<read_file><path>a.ts</path></read_file>\nand then some",
			specs,
		);
		expect(call).toEqual({
			toolName: "read_file",
			input: { path: "a.ts" },
			start: 0,
		});
	});

	it("rejects a call quoted inline in a sentence", () => {
		expect(
			extractExecutableXmlCall(
				"you could run <read_file><path>a.ts</path></read_file>",
				specs,
			),
		).toBeUndefined();
	});

	it("rejects a call inside an open markdown fence", () => {
		expect(
			extractExecutableXmlCall(
				"For example:\n```\n<read_file><path>a.ts</path></read_file>",
				specs,
			),
		).toBeUndefined();
	});

	it("skips a fenced example and runs the real call that follows", () => {
		const call = extractExecutableXmlCall(
			"For example:\n```xml\n<read_file><path>a.ts</path></read_file>\n```\n\n<read_file>\n<path>b.ts</path>\n</read_file>",
			specs,
		);
		expect(call?.input).toEqual({ path: "b.ts" });
		expect(call?.start).toBeGreaterThan(0);
	});

	it("skips an inline mention and runs the real call that follows", () => {
		const call = extractExecutableXmlCall(
			"you could run <read_file><path>a.ts</path></read_file>\n\n<read_file>\n<path>b.ts</path>\n</read_file>",
			specs,
		);
		expect(call?.input).toEqual({ path: "b.ts" });
	});
});

describe("translateXmlToolCallingStream", () => {
	it("streams prose as it arrives and emits a native tool call", async () => {
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "text-delta", text: "Let me look.\n<read_" },
					{ type: "text-delta", text: "file>\n<path>a.ts</path>\n" },
					{ type: "text-delta", text: "</read_file>" },
					{ type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
					{ type: "finish", reason: "stop" },
				),
				translation(),
			),
		);
		expect(events.map((event) => event.type)).toEqual([
			"text-delta",
			"usage",
			"tool-call-delta",
			"finish",
		]);
		const textEvent = events[0];
		if (textEvent?.type !== "text-delta") throw new Error("expected text");
		expect(textEvent.text).toBe("Let me look.");
		const toolEvent = events[2];
		if (toolEvent?.type !== "tool-call-delta")
			throw new Error("expected tool call");
		expect(toolEvent.toolName).toBe("read_file");
		expect(toolEvent.input).toEqual({ path: "a.ts" });
		expect(toolEvent.toolCallId).toMatch(/^xml_/);
		const finishEvent = events[3];
		if (finishEvent?.type !== "finish") throw new Error("expected finish");
		expect(finishEvent.reason).toBe("tool-calls");
	});

	it("passes reasoning deltas through live", async () => {
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "reasoning-delta", text: "thinking..." },
					{ type: "text-delta", text: "Done thinking." },
					{ type: "finish", reason: "stop" },
				),
				translation(),
			),
		);
		expect(events).toEqual([
			{ type: "reasoning-delta", text: "thinking..." },
			{ type: "text-delta", text: "Done thinking." },
			{ type: "finish", reason: "stop" },
		]);
	});

	it("emits raw text verbatim when no executable call is found", async () => {
		const raw =
			"Example only:\n```\n<read_file><path>a.ts</path></read_file>\n```\nSee?";
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "text-delta", text: raw },
					{ type: "finish", reason: "stop" },
				),
				translation(),
			),
		);
		expect(joinText(events)).toBe(raw);
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});

	it("keeps truncated tool calls as text instead of executing them", async () => {
		const raw = "Working.\n<read_file>\n<path>a.ts";
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "text-delta", text: raw },
					{ type: "finish", reason: "max-tokens" },
				),
				translation(),
			),
		);
		expect(joinText(events)).toBe(raw);
		expect(events.some((event) => event.type === "tool-call-delta")).toBe(
			false,
		);
		expect(events.at(-1)).toEqual({ type: "finish", reason: "max-tokens" });
	});

	it("never streams a partially formed tool tag as text", async () => {
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "text-delta", text: "Reading now.\n\n<read" },
					{ type: "text-delta", text: "_file>\n<path>a.ts</path></read_file>" },
					{ type: "finish", reason: "stop" },
				),
				translation(),
			),
		);
		expect(joinText(events)).toBe("Reading now.");
		expect(
			events.filter((event) => event.type === "tool-call-delta"),
		).toHaveLength(1);
	});

	it("preserves stream errors while still surfacing buffered text", async () => {
		const events = await collect(
			translateXmlToolCallingStream(
				stream(
					{ type: "text-delta", text: "partial answer" },
					{ type: "finish", reason: "error", error: "boom" },
				),
				translation(),
			),
		);
		expect(events).toEqual([
			{ type: "text-delta", text: "partial answer" },
			{ type: "finish", reason: "error", error: "boom" },
		]);
	});

	it("synthesizes a finish event when the provider stream omits one", async () => {
		const events = await collect(
			translateXmlToolCallingStream(
				stream({
					type: "text-delta",
					text: "<read_file><path>a.ts</path></read_file>",
				}),
				translation(),
			),
		);
		expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
	});
});
