import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime, AgentRuntimeAbortError } from "./agent-runtime";
import { Agent, createAgent } from "./index";

const { createAgentModel, createGateway } = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	const createGateway = vi.fn(() => ({
		createAgentModel,
	}));
	return { createAgentModel, createGateway };
});

vi.mock("@cline/llms", () => ({
	createGateway,
}));

class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

describe("AgentRuntime (provider-form config + Agent alias)", () => {
	beforeEach(() => {
		createGateway.mockClear();
		createAgentModel.mockReset();
	});

	it("constructs the runtime via the llms gateway in ESM-safe code", () => {
		const model = new ScriptedModel([]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai",
			modelId: "gpt-5",
			apiKey: "test-key",
		});

		expect(agent).toBeInstanceOf(Agent);
		expect(createGateway).toHaveBeenCalledWith({
			providerConfigs: [
				{
					providerId: "openai",
					apiKey: "test-key",
					baseUrl: undefined,
					headers: undefined,
					options: undefined,
				},
			],
		});
		expect(createAgentModel).toHaveBeenCalledWith({
			providerId: "openai",
			modelId: "gpt-5",
		});
	});

	it("passes provider options through to the llms gateway", () => {
		const model = new ScriptedModel([]);
		createAgentModel.mockReturnValue(model);

		new Agent({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
			baseUrl: "https://example.openai.azure.com/openai/deployments/gpt-4.1",
			options: { apiVersion: "2025-01-01-preview" },
		});

		expect(createGateway).toHaveBeenCalledWith({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl:
						"https://example.openai.azure.com/openai/deployments/gpt-4.1",
					headers: undefined,
					options: { apiVersion: "2025-01-01-preview" },
				},
			],
		});
	});

	it("forwards abort() to the active AgentRuntime", async () => {
		let abortReason: unknown;
		const model = new ScriptedModel([
			async function* (request) {
				yield { type: "text-delta", text: "partial" };
				await new Promise<void>((resolve) => {
					request.signal?.addEventListener(
						"abort",
						() => {
							abortReason = request.signal?.reason;
							resolve();
						},
						{ once: true },
					);
				});
				yield { type: "finish", reason: "aborted" };
			},
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai",
			modelId: "gpt-5",
		});

		const runPromise = agent.run("cancel me");
		for (let i = 0; i < 20; i += 1) {
			if (agent.snapshot().status === "running") {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		agent.abort("user cancelled");

		await expect(runPromise).resolves.toMatchObject({
			status: "aborted",
		});
		expect(abortReason).toBeInstanceOf(AgentRuntimeAbortError);
		if (!(abortReason instanceof AgentRuntimeAbortError)) {
			throw new Error("expected agent runtime abort reason");
		}
		expect(abortReason.message).toBe("user cancelled");
		expect(abortReason.reason).toBe("user cancelled");
	});

	it("createAgent() and new Agent() both return an AgentRuntime instance", () => {
		const model = new ScriptedModel([]);
		createAgentModel.mockReturnValue(model);

		const agent = createAgent({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
		});

		// After the facade/runtime merge (Option B), `Agent` is an alias for
		// `AgentRuntime`. Both constructors return the same class — verified
		// here so future refactors don't silently reintroduce a split.
		expect(agent).toBeInstanceOf(Agent);
		expect(agent).toBeInstanceOf(AgentRuntime);
		expect(Agent).toBe(AgentRuntime);
	});

	it("restores conversation state by rebuilding the runtime", () => {
		const model = new ScriptedModel([]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai",
			modelId: "gpt-5",
		});
		const messages: AgentMessage[] = [
			{
				id: "msg_1",
				role: "user",
				content: [{ type: "text", text: "hello" }],
				createdAt: 1,
			},
		];

		agent.restore(messages);

		expect(agent.snapshot().messages).toEqual(messages);
		expect(agent.snapshot().status).toBe("idle");
	});

	it("rebinds existing subscribers when restore() replaces the runtime", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "hello" },
				{ type: "finish", reason: "stop" },
			],
			() => [
				{ type: "text-delta", text: "again" },
				{ type: "finish", reason: "stop" },
			],
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai",
			modelId: "gpt-5",
		});
		const received: AgentRuntimeEvent["type"][] = [];
		const unsubscribe = agent.subscribe((event) => {
			received.push(event.type);
		});

		agent.restore([
			{
				id: "msg_1",
				role: "user",
				content: [{ type: "text", text: "restored" }],
				createdAt: 1,
			},
		]);
		await agent.run("hello");

		expect(received).toContain("run-started");
		expect(received).toContain("run-finished");

		const countAfterRun = received.length;
		unsubscribe();
		await agent.run("again");
		expect(received).toHaveLength(countAfterRun);
	});

	it("derives messageModelInfo from providerId/modelId so assistant messages carry model tags", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "hi" },
				{ type: "finish", reason: "stop" },
			],
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
		});

		const result = await agent.run("hello");

		const assistant = result.messages.find((m) => m.role === "assistant");
		expect(assistant?.modelInfo).toEqual({
			id: "claude-sonnet-4-6",
			provider: "anthropic",
		});
	});

	it("prefers an explicit messageModelInfo over the derived provider/model", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "hi" },
				{ type: "finish", reason: "stop" },
			],
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			messageModelInfo: {
				id: "explicit-model",
				provider: "explicit-provider",
				family: "explicit-family",
			},
		});

		const result = await agent.run("hello");

		const assistant = result.messages.find((m) => m.role === "assistant");
		expect(assistant?.modelInfo).toEqual({
			id: "explicit-model",
			provider: "explicit-provider",
			family: "explicit-family",
		});
	});
});
