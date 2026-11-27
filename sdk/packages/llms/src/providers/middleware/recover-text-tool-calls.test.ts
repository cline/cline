import type {
	LanguageModelV4CallOptions,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	parseTextToolCalls,
	recoverTextToolCallsMiddleware,
} from "./recover-text-tool-calls";

const TOOLS = new Set(["read_file", "run_commands"]);

const params = {
	prompt: [],
	tools: [
		{
			type: "function",
			name: "read_file",
			description: "",
			inputSchema: { type: "object" },
		},
	],
} as unknown as LanguageModelV4CallOptions;

const FINISH = {
	type: "finish",
	finishReason: { unified: "stop", raw: "stop" },
	usage: {},
} as unknown as LanguageModelV4StreamPart;

async function runStream(
	chunks: string[],
	callParams = params,
): Promise<LanguageModelV4StreamPart[]> {
	const parts: LanguageModelV4StreamPart[] = [
		{ type: "text-start", id: "t" },
		...chunks.map(
			(delta) =>
				({ type: "text-delta", id: "t", delta }) as LanguageModelV4StreamPart,
		),
		{ type: "text-end", id: "t" },
		FINISH,
	];
	const result = await recoverTextToolCallsMiddleware.wrapStream?.({
		doStream: async () => ({
			stream: new ReadableStream({
				start(controller) {
					for (const part of parts) controller.enqueue(part);
					controller.close();
				},
			}),
		}),
		params: callParams,
	} as never);
	const out: LanguageModelV4StreamPart[] = [];
	if (!result) throw new Error("wrapStream missing");
	const reader = result.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

describe("parseTextToolCalls", () => {
	it("parses name/arguments JSON for a known tool", () => {
		expect(
			parseTextToolCalls(
				'{"name":"read_file","arguments":{"path":"a.ts"}}',
				TOOLS,
			),
		).toEqual([{ toolName: "read_file", input: '{"path":"a.ts"}' }]);
	});

	it("accepts parameters, string arguments, fences and arrays", () => {
		expect(
			parseTextToolCalls(
				'```json\n[{"name":"read_file","parameters":{"path":"a"}},{"name":"run_commands","arguments":"{\\"c\\":1}"}]\n```',
				TOOLS,
			),
		).toEqual([
			{ toolName: "read_file", input: '{"path":"a"}' },
			{ toolName: "run_commands", input: '{"c":1}' },
		]);
	});

	it("rejects unknown tools, prose and non-object arguments", () => {
		expect(
			parseTextToolCalls('{"name":"nope","arguments":{}}', TOOLS),
		).toBeUndefined();
		expect(
			parseTextToolCalls('Sure: {"name":"read_file","arguments":{}}', TOOLS),
		).toBeUndefined();
		expect(
			parseTextToolCalls('{"name":"read_file","arguments":[1]}', TOOLS),
		).toBeUndefined();
		expect(
			parseTextToolCalls('{"name":"read_file","arguments":{}}', new Set()),
		).toBeUndefined();
	});
});

describe("recoverTextToolCallsMiddleware", () => {
	it("converts a streamed JSON tool call into a tool-call part", async () => {
		const parts = await runStream([
			'{"name":"read_',
			'file","arguments":{"path":"a.ts"}}',
		]);
		expect(parts.map((p) => p.type)).toEqual(["tool-call", "finish"]);
		expect(parts[0]).toMatchObject({
			toolName: "read_file",
			input: '{"path":"a.ts"}',
		});
		expect(
			(parts[1] as { finishReason: { unified: string } }).finishReason.unified,
		).toBe("tool-calls");
	});

	it("passes prose through unchanged", async () => {
		const parts = await runStream(["Hello ", "there"]);
		expect(parts.map((p) => p.type)).toEqual([
			"text-start",
			"text-delta",
			"text-delta",
			"text-end",
			"finish",
		]);
	});

	it("flushes JSON text that is not a known tool call", async () => {
		const parts = await runStream(['{"name":"other","arguments":{}}']);
		expect(parts.map((p) => p.type)).toEqual([
			"text-start",
			"text-delta",
			"text-end",
			"finish",
		]);
	});

	it("does nothing when the request has no tools", async () => {
		const parts = await runStream(['{"name":"read_file","arguments":{}}'], {
			prompt: [],
		} as LanguageModelV4CallOptions);
		expect(parts.map((p) => p.type)).toContain("text-delta");
	});

	it("converts a non-streaming JSON text answer", async () => {
		const result = await recoverTextToolCallsMiddleware.wrapGenerate?.({
			doGenerate: async () => ({
				content: [
					{
						type: "text",
						text: '{"name":"read_file","arguments":{"path":"x"}}',
					},
				],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {},
				warnings: [],
			}),
			params,
		} as never);
		expect(result?.content).toHaveLength(1);
		expect(result?.content[0]).toMatchObject({
			type: "tool-call",
			toolName: "read_file",
		});
		expect(result?.finishReason.unified).toBe("tool-calls");
	});
});
