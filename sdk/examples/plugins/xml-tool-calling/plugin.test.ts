import { describe, expect, it } from "bun:test";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeStateSnapshot,
	AgentTool,
} from "@cline/shared";
import plugin, { rewriteHistoryForXml } from "./index.ts";

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent-test",
		status: "running",
		iteration: 1,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
}

const ECHO_TOOL: AgentTool<{ text: string }, { echoed: string }> = {
	name: "echo",
	description: "Echo input text back.",
	inputSchema: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
	},
	async execute(input) {
		return { echoed: input.text };
	},
};

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => AgentModelEvent[]
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		const events = step(request);
		return (async function* () {
			yield* events;
		})();
	}
}

describe("beforeModel", () => {
	it("strips native tools, appends XML docs, and rewrites tool history", async () => {
		const result = await plugin.hooks?.beforeModel?.({
			snapshot: makeSnapshot(),
			request: {
				systemPrompt: "You are a helpful assistant.",
				messages: [
					{
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "echo hi" }],
						createdAt: 1,
					},
					{
						id: "a1",
						role: "assistant",
						content: [
							{ type: "text", text: "Echoing." },
							{
								type: "tool-call",
								toolCallId: "call_1",
								toolName: "echo",
								input: { text: "hi" },
							},
						],
						createdAt: 2,
					},
					{
						id: "t1",
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_1",
								toolName: "echo",
								output: { echoed: "hi" },
							},
						],
						createdAt: 3,
					},
				],
				tools: [ECHO_TOOL],
			},
		});

		expect(result?.tools).toEqual([]);
		expect(result?.systemPrompt).toContain("You are a helpful assistant.");
		expect(result?.systemPrompt).toContain("TOOL USE");
		expect(result?.systemPrompt).toContain("## echo");

		const messages = result?.messages;
		expect(messages).toHaveLength(3);
		const assistant = messages?.[1];
		expect(assistant?.content).toEqual([
			{ type: "text", text: "Echoing." },
			{ type: "text", text: "<echo>\n<text>hi</text>\n</echo>" },
		]);
		const toolTurn = messages?.[2];
		expect(toolTurn?.role).toBe("user");
		expect(toolTurn?.content).toEqual([
			{
				type: "text",
				text: `[echo] Result:\n${JSON.stringify({ echoed: "hi" }, null, 2)}`,
			},
		]);
	});

	it("does nothing when the request has no tools and no tool history", async () => {
		const result = await plugin.hooks?.beforeModel?.({
			snapshot: makeSnapshot(),
			request: {
				messages: [
					{
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "hello" }],
						createdAt: 1,
					},
				],
				tools: [],
			},
		});
		expect(result).toBeUndefined();
	});
});

describe("afterModel", () => {
	it("converts XML tool uses into native tool-call parts", async () => {
		const snapshot = makeSnapshot();
		await plugin.hooks?.beforeModel?.({
			snapshot,
			request: { messages: [], tools: [ECHO_TOOL] },
		});

		const result = await plugin.hooks?.afterModel?.({
			snapshot,
			assistantMessage: {
				id: "a1",
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I will echo now.\n<echo>\n<text>hi there</text>\n</echo>",
					},
				],
				createdAt: 1,
			},
			finishReason: "stop",
		});

		expect(result?.message?.content).toEqual([
			{ type: "text", text: "I will echo now." },
			{
				type: "tool-call",
				toolCallId: expect.stringMatching(/^xml_call_\d+$/),
				toolName: "echo",
				input: { text: "hi there" },
			},
		]);
	});

	it("leaves plain-text replies untouched", async () => {
		const snapshot = makeSnapshot();
		await plugin.hooks?.beforeModel?.({
			snapshot,
			request: { messages: [], tools: [ECHO_TOOL] },
		});

		const result = await plugin.hooks?.afterModel?.({
			snapshot,
			assistantMessage: {
				id: "a1",
				role: "assistant",
				content: [{ type: "text", text: "All done!" }],
				createdAt: 1,
			},
			finishReason: "stop",
		});
		expect(result).toBeUndefined();
	});

	it("keeps unclosed tool uses as raw text instead of executing them", async () => {
		const snapshot = makeSnapshot();
		await plugin.hooks?.beforeModel?.({
			snapshot,
			request: { messages: [], tools: [ECHO_TOOL] },
		});

		const result = await plugin.hooks?.afterModel?.({
			snapshot,
			assistantMessage: {
				id: "a1",
				role: "assistant",
				content: [{ type: "text", text: "<echo>\n<text>truncat" }],
				createdAt: 1,
			},
			finishReason: "max-tokens",
		});
		expect(result).toBeUndefined();
	});
});

describe("rewriteHistoryForXml", () => {
	it("returns undefined for histories without tool parts", () => {
		expect(
			rewriteHistoryForXml([
				{
					id: "u1",
					role: "user",
					content: [{ type: "text", text: "hello" }],
					createdAt: 1,
				},
			]),
		).toBeUndefined();
	});
});

describe("end to end with AgentRuntime", () => {
	it("drives a full XML tool-calling turn through the runtime", async () => {
		const model = new ScriptedModel([
			(request) => {
				expect(request.tools).toEqual([]);
				expect(request.systemPrompt).toContain("TOOL USE");
				expect(request.systemPrompt).toContain("## echo");
				return [
					{
						type: "text-delta",
						text: "Echoing.\n<echo>\n<text>hello world</text>\n</echo>",
					},
					{ type: "finish", reason: "stop" },
				];
			},
			(request) => {
				expect(request.tools).toEqual([]);
				// The assistant's tool call went back out as XML text...
				const assistant = request.messages.find(
					(message) => message.role === "assistant",
				);
				expect(assistant?.content.every((part) => part.type === "text")).toBe(
					true,
				);
				expect(JSON.stringify(assistant?.content)).toContain("<echo>");
				// ...and the tool result came back as a plain user message.
				const last = request.messages.at(-1);
				expect(last?.role).toBe("user");
				expect(JSON.stringify(last?.content)).toContain("[echo] Result:");
				expect(JSON.stringify(last?.content)).toContain("hello world");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);

		const runtime = new AgentRuntime({
			model,
			systemPrompt: "You are a test agent.",
			tools: [ECHO_TOOL],
			hooks: plugin.hooks,
		});

		const result = await runtime.run("Please echo 'hello world'.");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
		expect(model.requests).toHaveLength(2);

		// Internal state stays native: the stored assistant message carries a
		// real tool-call part, and the tool message a real tool-result part.
		const assistant = result.messages.find(
			(message) =>
				message.role === "assistant" &&
				message.content.some((part) => part.type === "tool-call"),
		);
		expect(assistant).toBeDefined();
		const toolMessage = result.messages.find(
			(message) => message.role === "tool",
		);
		expect(
			toolMessage?.content.some(
				(part) =>
					part.type === "tool-result" &&
					JSON.stringify(part.output).includes("hello world"),
			),
		).toBe(true);
	});
});
