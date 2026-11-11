import type {
	AgentConfig,
	AgentEvent,
	AgentMessage,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ModelInfo,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildForkModelRequest,
	EphemeralForkController,
	FORK_THINKING_ALLOWANCE_TOKENS,
} from "./ephemeral-fork";
import { SessionRuntime } from "./session-runtime-orchestrator";

type Responder = (request: AgentModelRequest) => AgentModelEvent[];

const model = vi.hoisted(() => ({
	requests: [] as AgentModelRequest[],
	responders: [] as Array<
		(request: AgentModelRequest) => AsyncIterable<AgentModelEvent>
	>,
}));

vi.mock("../../services/llms/handler-factory", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../services/llms/handler-factory")
		>();
	return {
		...actual,
		createAgentModelFromConfig: () => ({
			stream: async (request: AgentModelRequest) => {
				model.requests.push(request);
				const respond = model.responders.shift();
				if (!respond) throw new Error("no scripted model response");
				return respond(request);
			},
		}),
	};
});

function respondWith(responder: Responder): void {
	model.responders.push(async function* (request) {
		yield* responder(request);
	});
}

function respondWithText(text: string): void {
	respondWith(() => [
		{ type: "text-delta", text },
		{
			type: "usage",
			usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 90 },
		},
		{ type: "finish", reason: "stop" },
	]);
}

/** A fork stream that stays open until its request is aborted. */
function respondUntilAborted(): void {
	model.responders.push(async function* (request) {
		yield { type: "text-delta", text: "partial" };
		await new Promise<void>((resolve) => {
			if (request.signal?.aborted) resolve();
			request.signal?.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
	});
}

const promptCachedModel: ModelInfo = {
	id: "test-model",
	capabilities: ["prompt-cache", "tools"],
};

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		providerId: "anthropic",
		modelId: "test-model",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		knownModels: { "test-model": promptCachedModel },
		...overrides,
	};
}

const asidePlugin: NonNullable<AgentConfig["extensions"]>[number] = {
	name: "asker",
	manifest: { capabilities: ["asides"] },
};

/** A root runtime with a plugin that declares asides, and the run ids its runs reported. */
function makeSession(
	overrides: Partial<AgentConfig> = {},
	extensions: AgentConfig["extensions"] = [asidePlugin],
) {
	const runIds: string[] = [];
	const session = new SessionRuntime(
		makeConfig({
			hooks: {
				afterRun: ({ snapshot }) => {
					runIds.push(snapshot.runId ?? "");
				},
			},
			extensions,
			...overrides,
		}),
	);
	return { session, runIds };
}

function forkRequest(
	runId: string,
	instruction = "Suggest the next prompt.",
	maxOutputTokens?: number,
) {
	return {
		runId,
		instruction,
		...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
	};
}

function withoutVolatileFields(request: AgentModelRequest) {
	const { signal: _signal, messages: _messages, options, ...rest } = request;
	const metadata = { ...(options?.metadata as Record<string, unknown>) };
	delete metadata.modelRequestId;
	return { ...rest, options: { ...options, metadata } };
}

const echoTool: AgentTool = {
	name: "echo",
	description: "Echo the input",
	inputSchema: { type: "object", properties: {} },
	execute: vi.fn(async () => ({ ok: true })),
};

beforeEach(() => {
	model.requests.length = 0;
	model.responders.length = 0;
});

describe("SessionRuntime.fork", () => {
	it("forks the last request unchanged except for the appended messages", async () => {
		const { session, runIds } = makeSession({
			tools: [echoTool],
			thinkingBudgetTokens: 1024,
		});
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondWithText("Run the tests");
		const result = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(model.requests).toHaveLength(2);
		const [recorded, fork] = model.requests as [
			AgentModelRequest,
			AgentModelRequest,
		];
		expect(withoutVolatileFields(fork)).toEqual(
			withoutVolatileFields(recorded),
		);
		expect(fork.tools.map((tool) => tool.name)).toEqual(["echo"]);
		expect(fork.messages.slice(0, recorded.messages.length)).toEqual(
			recorded.messages,
		);
		const appended = fork.messages.slice(recorded.messages.length);
		expect(appended.map((message) => message.role)).toEqual([
			"assistant",
			"user",
		]);
		expect(appended[0]?.content).toEqual([{ type: "text", text: "Done." }]);
		expect(appended[1]?.content).toEqual([
			{ type: "text", text: "Suggest the next prompt." },
		]);
		expect(fork.options?.maxTokens).toBe(recorded.options?.maxTokens);
		expect(
			(fork.options?.metadata as Record<string, unknown>).modelRequestId,
		).not.toBe(
			(recorded.options?.metadata as Record<string, unknown>).modelRequestId,
		);
		expect(result).toEqual({
			runId: runIds[0],
			text: "Run the tests",
			usage: {
				inputTokens: 100,
				outputTokens: 5,
				cacheReadTokens: 90,
				cacheWriteTokens: 0,
				reasoningTokenCount: 0,
				totalCost: 0,
			},
			calledTools: [],
		});
	});

	it("overrides the output cap only when one is set, keeping room for the thinking budget", async () => {
		const { session, runIds } = makeSession({ thinkingBudgetTokens: 1024 });
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondWithText("Run the tests");
		await session.fork(
			forkRequest(runIds[0] ?? "", "Suggest the next prompt.", 64),
		);

		const [recorded, fork] = model.requests as [
			AgentModelRequest,
			AgentModelRequest,
		];
		expect(fork.options?.maxTokens).toBe(64 + 1024);
		const { maxTokens: _cap, ...forkOptions } = withoutVolatileFields(fork)
			.options as Record<string, unknown>;
		expect(forkOptions).toEqual(withoutVolatileFields(recorded).options);
	});

	it.each([
		{
			name: "adds the adaptive thinking allowance when the turn thinks without a budget",
			config: {},
			cap: 64 + FORK_THINKING_ALLOWANCE_TOKENS,
		},
		{
			name: "adds no thinking room when thinking is off",
			config: { thinking: false, thinkingBudgetTokens: 1024 },
			cap: 64,
		},
	])("$name", async ({ config, cap }) => {
		const { session, runIds } = makeSession(config);
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondWithText("Run the tests");
		await session.fork(
			forkRequest(runIds[0] ?? "", "Suggest the next prompt.", 64),
		);

		expect(model.requests[1]?.options?.maxTokens).toBe(cap);
	});

	it("keeps the fork out of the transcript, events and tool execution", async () => {
		const { session, runIds } = makeSession({ tools: [echoTool] });
		respondWithText("Done.");
		await session.run("Fix the bug");
		const messagesBefore = structuredClone(session.getMessages());
		const events: AgentEvent[] = [];
		session.subscribeEvents((event) => events.push(event));

		respondWith(() => [
			{ type: "text-delta", text: "Let me check." },
			{
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "echo",
				input: {},
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		const result = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(result).toMatchObject({
			text: "Let me check.",
			calledTools: ["echo"],
		});
		expect(echoTool.execute).not.toHaveBeenCalled();
		expect(session.getMessages()).toEqual(messagesBefore);
		expect(events).toEqual([]);
	});

	it("aborts a fork in flight when the next run starts", async () => {
		const { session, runIds } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondUntilAborted();
		const forked = session.fork(forkRequest(runIds[0] ?? ""));
		await vi.waitFor(() => expect(model.requests).toHaveLength(2));
		respondWithText("Next answer.");
		await session.run("Next");

		expect(await forked).toEqual({ runId: runIds[0], unavailable: "aborted" });
	});

	it("runs two forks of one run side by side", async () => {
		const { session, runIds } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondUntilAborted();
		const first = session.fork(forkRequest(runIds[0] ?? ""));
		await vi.waitFor(() => expect(model.requests).toHaveLength(2));
		respondWithText("Second.");
		const second = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(second).toMatchObject({ text: "Second." });
		await session.shutdown();
		expect(await first).toEqual({ runId: runIds[0], unavailable: "aborted" });
	});

	it("aborts a fork in flight when its own signal aborts", async () => {
		const { session, runIds } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondUntilAborted();
		const caller = new AbortController();
		const forked = session.fork({
			...forkRequest(runIds[0] ?? ""),
			signal: caller.signal,
		});
		await vi.waitFor(() => expect(model.requests).toHaveLength(2));
		caller.abort();

		expect(await forked).toEqual({ runId: runIds[0], unavailable: "aborted" });
	});

	it("aborts a fork in flight when the session shuts down", async () => {
		const { session, runIds } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondUntilAborted();
		const forked = session.fork(forkRequest(runIds[0] ?? ""));
		await vi.waitFor(() => expect(model.requests).toHaveLength(2));
		await session.shutdown();

		expect(await forked).toEqual({ runId: runIds[0], unavailable: "aborted" });
	});

	it("answers a stale runId without calling the model", async () => {
		const { session, runIds } = makeSession();
		respondWithText("First.");
		await session.run("One");
		respondWithText("Second.");
		await session.continue("Two");

		const result = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(runIds).toHaveLength(2);
		expect(runIds[0]).not.toBe(runIds[1]);
		expect(model.requests).toHaveLength(2);
		expect(result).toEqual({ runId: runIds[0], unavailable: "stale_run" });
	});

	it("forks the latest run when no runId is given", async () => {
		const { session, runIds } = makeSession();
		respondWithText("First.");
		await session.run("One");
		respondWithText("Second.");
		await session.continue("Two");

		respondWithText("About the second.");
		const result = await session.fork({ instruction: "What changed?" });

		expect(result).toMatchObject({
			runId: runIds[1],
			text: "About the second.",
		});
		const [, second, fork] = model.requests as AgentModelRequest[];
		expect(fork?.messages.slice(0, -2)).toEqual(second?.messages);
	});

	it("forks a run that is still working, answering the tool call it waits on", async () => {
		let finishTool = () => {};
		const execute = vi.fn(async () => {
			await new Promise<void>((resolve) => {
				finishTool = resolve;
			});
			return { ok: true };
		});
		const { session, runIds } = makeSession({
			tools: [{ ...echoTool, execute }],
		});
		respondWith(() => [
			{
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "echo",
				input: {},
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		const run = session.run("Fix the bug");
		await vi.waitFor(() => expect(execute).toHaveBeenCalled());

		respondWithText("It is running echo.");
		const result = await session.fork({ instruction: "What is it doing?" });

		respondWithText("Done.");
		finishTool();
		await run;

		expect(result).toMatchObject({
			runId: runIds[0],
			text: "It is running echo.",
		});
		const [first, fork, last] = model.requests as [
			AgentModelRequest,
			AgentModelRequest,
			AgentModelRequest,
		];
		const appended = fork.messages.slice(first.messages.length);
		expect(appended.map((message) => message.role)).toEqual([
			"assistant",
			"tool",
			"user",
		]);
		expect(appended[1]?.content).toEqual([
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "call_1",
				isError: true,
			}),
		]);
		expect(execute).toHaveBeenCalledTimes(1);
		const sentAfter = JSON.stringify(last.messages);
		expect(sentAfter).not.toContain("What is it doing?");
		expect(sentAfter).not.toContain("It is running echo.");
		expect(JSON.stringify(session.getMessages())).not.toContain(
			"What is it doing?",
		);
	});

	it("counts a run as the latest until the next one begins", async () => {
		const { session, runIds } = makeSession();
		expect(session.isLatestRun("run_x")).toBe(false);

		respondWithText("First.");
		await session.run("One");
		expect(session.isLatestRun(runIds[0] ?? "")).toBe(true);

		respondWithText("Second.");
		await session.continue("Two");
		expect(session.isLatestRun(runIds[0] ?? "")).toBe(false);
		expect(session.isLatestRun(runIds[1] ?? "")).toBe(true);

		await session.shutdown();
		expect(session.isLatestRun(runIds[1] ?? "")).toBe(false);
	});

	it("answers before any run with no recorded request", async () => {
		const { session } = makeSession();

		expect(await session.fork(forkRequest("run_x"))).toEqual({
			runId: "run_x",
			unavailable: "no_recorded_request",
		});
	});

	it("refuses a model the catalog does not mark as prompt-cached", async () => {
		const { session, runIds } = makeSession({
			knownModels: {
				"test-model": { id: "test-model", capabilities: ["tools"] },
			},
		});
		respondWithText("Done.");
		await session.run("Fix the bug");

		const result = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(model.requests).toHaveLength(1);
		expect(result).toEqual({
			runId: runIds[0],
			unavailable: "no_prompt_cache",
		});
	});

	it("reports provider errors", async () => {
		const { session, runIds } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		respondWith(() => [
			{ type: "finish", reason: "error", error: "overloaded" },
		]);

		expect(await session.fork(forkRequest(runIds[0] ?? ""))).toEqual({
			runId: runIds[0],
			unavailable: "provider_error",
			error: "overloaded",
		});
	});
});

describe("fork recording", () => {
	it.each([
		{ name: "no plugin declares asides", overrides: {}, extensions: [] },
		{
			name: "the runtime has a parent agent",
			overrides: { parentAgentId: "lead" },
			extensions: [asidePlugin],
		},
	])("never wraps the model or records a request when $name", async ({
		overrides,
		extensions,
	}) => {
		const recordingModel = vi.spyOn(
			EphemeralForkController.prototype,
			"recordingModel",
		);
		const { session, runIds } = makeSession(overrides, extensions);
		respondWithText("Done.");
		await session.run("Fix the bug");

		const result = await session.fork(forkRequest(runIds[0] ?? ""));

		expect(recordingModel).not.toHaveBeenCalled();
		expect(model.requests).toHaveLength(1);
		expect(result).toEqual({
			runId: runIds[0],
			unavailable: "no_recorded_request",
		});
		recordingModel.mockRestore();
	});

	it("records in a root runtime with a plugin that declares asides", async () => {
		const recordingModel = vi.spyOn(
			EphemeralForkController.prototype,
			"recordingModel",
		);
		const { session } = makeSession();
		respondWithText("Done.");
		await session.run("Fix the bug");

		expect(recordingModel).toHaveBeenCalledTimes(1);
		recordingModel.mockRestore();
	});
});

describe("buildForkModelRequest", () => {
	it("answers tool calls the run left open so the provider accepts the transcript", () => {
		const reply: AgentMessage = {
			id: "reply",
			role: "assistant",
			content: [
				{ type: "tool-call", toolCallId: "a", toolName: "echo", input: {} },
				{ type: "tool-call", toolCallId: "b", toolName: "echo", input: {} },
			],
			createdAt: 1,
		};
		const answered: AgentMessage = {
			id: "results",
			role: "tool",
			content: [
				{ type: "tool-result", toolCallId: "a", toolName: "echo", output: 1 },
			],
			createdAt: 2,
		};

		const request = buildForkModelRequest({
			recorded: { messages: [], tools: [] },
			followingMessages: [reply, answered],
			instruction: "next?",
			maxTokens: 10,
			signal: new AbortController().signal,
		});

		expect(request.messages.map((message) => message.role)).toEqual([
			"assistant",
			"tool",
			"tool",
			"user",
		]);
		expect(request.messages[2]?.content).toEqual([
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "b",
				isError: true,
			}),
		]);
	});
});
