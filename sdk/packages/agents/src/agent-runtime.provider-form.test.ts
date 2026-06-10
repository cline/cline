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

const { createAgentModel, createGateway, llmsModule } = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	const createGateway = vi.fn(() => ({
		createAgentModel,
	}));
	const llmsModule = { createGateway };
	return { createAgentModel, createGateway, llmsModule };
});

vi.mock("@cline/llms", () => llmsModule);

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
		llmsModule.createGateway = createGateway;
	});

	it("constructs the runtime synchronously and resolves the llms gateway on first run", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "hello" },
				{ type: "finish", reason: "stop" },
			],
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai",
			modelId: "gpt-5",
			apiKey: "test-key",
		});

		expect(agent).toBeInstanceOf(Agent);
		expect(createGateway).not.toHaveBeenCalled();

		await expect(agent.run("hi")).resolves.toMatchObject({
			status: "completed",
			outputText: "hello",
		});
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
			telemetry: undefined,
		});
		expect(createAgentModel).toHaveBeenCalledWith({
			providerId: "openai",
			modelId: "gpt-5",
		});
	});

	it("passes provider options through to the llms gateway on first run", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "configured" },
				{ type: "finish", reason: "stop" },
			],
		]);
		createAgentModel.mockReturnValue(model);

		const agent = new Agent({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
			baseUrl: "https://example.openai.azure.com/openai/deployments/gpt-4.1",
			options: { apiVersion: "2025-01-01-preview" },
		});

		expect(createGateway).not.toHaveBeenCalled();
		await expect(agent.run("hi")).resolves.toMatchObject({
			status: "completed",
			outputText: "configured",
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
			telemetry: undefined,
		});
	});

	it("reports a clear error when the browser llms entry lacks createGateway", async () => {
		llmsModule.createGateway = undefined as unknown as typeof createGateway;
		const agent = new Agent({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
		});

		const result = await agent.run("hi");

		expect(result.status).toBe("failed");
		expect(result.error?.message).toBe(
			"@cline/agents browser builds require a prebuilt AgentModel. Provider-id construction uses @cline/llms and is Node-only.",
		);
	});

	it("retries initialization after restore() clears a failed init attempt", async () => {
		llmsModule.createGateway = undefined as unknown as typeof createGateway;
		const agent = new Agent({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
		});

		await expect(agent.run("hi")).resolves.toMatchObject({
			status: "failed",
		});

		llmsModule.createGateway = createGateway;
		createAgentModel.mockReturnValue(
			new ScriptedModel([
				() => [
					{ type: "text-delta", text: "recovered" },
					{ type: "finish", reason: "stop" },
				],
			]),
		);
		agent.restore([
			{
				id: "msg_1",
				role: "user",
				content: [{ type: "text", text: "restored" }],
				createdAt: 1,
			},
		]);

		await expect(agent.run("hi again")).resolves.toMatchObject({
			status: "completed",
			outputText: "recovered",
		});
		expect(createGateway).toHaveBeenCalledTimes(1);
	});

	it("forwards abort() to the active AgentRuntime", async () => {
		let abortReason: unknown;
		let resolveStreamStarted!: () => void;
		const streamStarted = new Promise<void>((resolve) => {
			resolveStreamStarted = resolve;
		});
		const model = new ScriptedModel([
			async function* (request) {
				yield { type: "text-delta", text: "partial" };
				resolveStreamStarted();
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
		await streamStarted;
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
});
