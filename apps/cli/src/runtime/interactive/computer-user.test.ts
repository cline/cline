import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import {
	COMPUTER_USER_SYSTEM_PROMPT,
	ComputerTaskArtifactRecorder,
	ComputerUseClient,
} from "@cline/core";
import type {
	AgentHooks,
	AgentMessage,
	AgentResult,
	AgentRuntimeStateSnapshot,
	AgentTool,
	AgentToolContext,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	createInteractiveComputerUser,
	resolveHelperModelId,
	withHelperReasoningControls,
} from "./computer-user";

const createCliCoreMock = vi.hoisted(() => vi.fn());
const releaseAbortRejectionShieldMock = vi.hoisted(() => vi.fn());
const acquireAbortRejectionShieldMock = vi.hoisted(() =>
	vi.fn(() => releaseAbortRejectionShieldMock),
);

vi.mock("../../session/session", () => ({
	createCliCore: createCliCoreMock,
}));

vi.mock("../active-runtime", () => ({
	acquireAbortRejectionShield: acquireAbortRejectionShieldMock,
}));

const toolContext: AgentToolContext = {
	agentId: "driver-agent",
	conversationId: "driver-conversation",
	iteration: 1,
};

/**
 * Stub qbt backend answering get_display_info, which tool construction
 * always performs (the backend is the sole source of truth for display
 * dimensions). Tracks sockets so teardown can force-close the tool's
 * internal client connection.
 */
function startStubBackend(): Promise<{
	server: Server;
	port: number;
	destroyConnections: () => void;
	actions: string[];
}> {
	const sockets = new Set<Socket>();
	const actions: string[] = [];
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.trim().length > 0) {
						const request = JSON.parse(line) as { id: number; action: string };
						actions.push(request.action);
						socket.write(
							`${JSON.stringify({
								id: request.id,
								ok: true,
								display: { widthPx: 1920, heightPx: 1080 },
								...(request.action === "screenshot"
									? {
											image: { data: "c2NyZWVu", mediaType: "image/png" },
											foregroundWindow: {
												executable: "editor.exe",
												title: "Document",
											},
										}
									: {}),
							})}\n`,
						);
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({
				server,
				port: address.port,
				actions,
				destroyConnections: () => {
					for (const socket of sockets) {
						socket.destroy();
					}
				},
			});
		});
	});
}

function makeConfig(): Config {
	return {
		cwd: "C:/work",
		workspaceRoot: "C:/work",
	} as Config;
}

function makeSettings(settings: Record<string, unknown> | undefined) {
	return {
		getProviderSettings: () => settings as never,
	};
}

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "done",
		iterations: 1,
		finishReason: "completed",
		messages: [],
		toolCalls: [],
		usage: { inputTokens: 1, outputTokens: 1 },
		...overrides,
	} as AgentResult;
}

describe("createInteractiveComputerUser", () => {
	let server: Server | undefined;
	let destroyConnections: (() => void) | undefined;

	beforeEach(() => {
		createCliCoreMock.mockReset();
		releaseAbortRejectionShieldMock.mockReset();
		acquireAbortRejectionShieldMock.mockClear();
	});

	afterEach(async () => {
		destroyConnections?.();
		destroyConnections = undefined;
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	});

	it("returns undefined when computer use is not enabled by env", async () => {
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			emitSteerMessage: () => {},
			env: {} as NodeJS.ProcessEnv,
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined when the Anthropic provider has no api key", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;

		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings(undefined),
			emitSteerMessage: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
			} as NodeJS.ProcessEnv,
		});
		expect(result).toBeUndefined();
	});

	it("exposes the driver tools when enabled and configured", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;

		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({
				apiKey: "sk-ant-x",
				model: "claude-sonnet-4-6",
			}),
			emitSteerMessage: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
			} as NodeJS.ProcessEnv,
		});
		expect(result).toBeDefined();
		expect(result?.driverTools.map((tool) => tool.name).sort()).toEqual([
			"computer_user_interrupt",
			"computer_user_message",
			"computer_user_restart",
			"computer_user_start",
			"computer_user_transcript",
		]);
		// The raw computer tool must not be among the driver's tools.
		expect(result?.driverTools.some((tool) => tool.name === "computer")).toBe(
			false,
		);
		await result?.dispose();
	});

	it("adds the backend restart tool only when a launch command is configured", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;

		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({
				apiKey: "sk-ant-x",
				model: "claude-sonnet-4-6",
			}),
			emitSteerMessage: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
				CLINE_COMPUTER_USE_BACKEND_COMMAND: "echo start-the-backend",
			} as NodeJS.ProcessEnv,
		});
		expect(result).toBeDefined();
		expect(
			result?.driverTools
				.map((tool) => tool.name)
				.includes("computer_user_restart_backend"),
		).toBe(true);
		await result?.dispose();
	});

	it("reads the local transcript repeatedly without network requests or recording reads", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;
		let helperHooks: AgentHooks | undefined;
		createCliCoreMock.mockResolvedValue({
			start: vi.fn(async ({ config }: { config: { hooks: AgentHooks } }) => {
				helperHooks = config.hooks;
				return { sessionId: "helper-session" };
			}),
			send: vi.fn(async () => makeResult()),
			abort: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		});
		const emitSteerMessage = vi.fn();
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			emitSteerMessage,
			env: { CLINE_COMPUTER_USE_PORT: String(started.port) },
		});
		if (!result) throw new Error("computer user was not configured");
		const start = result.driverTools.find(
			(tool) => tool.name === "computer_user_start",
		);
		const transcript = result.driverTools.find(
			(tool) => tool.name === "computer_user_transcript",
		);
		// Observe the real recorder and transports; reads must not invoke them.
		const record = vi.spyOn(ComputerTaskArtifactRecorder.prototype, "record");
		const send = vi.spyOn(ComputerUseClient.prototype, "send");
		const fetch = vi.spyOn(globalThis, "fetch");
		try {
			if (!start || !transcript) throw new Error("missing computer user tools");
			await start.execute({ task: "inspect" }, toolContext);
			await vi.waitFor(() => expect(emitSteerMessage).toHaveBeenCalled());
			if (!helperHooks?.onEvent) throw new Error("missing recording hook");
			await helperHooks.onEvent({
				type: "message-added",
				snapshot: { agentId: "helper-agent" } as never,
				message: {
					id: "helper-message",
					role: "assistant",
					content: [{ type: "text", text: "ORANGES" }],
					createdAt: 0,
				},
			});
			// Drain existing publications before measuring inspection traffic.
			const recorder = record.mock.contexts[0];
			if (!(recorder instanceof ComputerTaskArtifactRecorder)) {
				throw new Error("missing artifact recorder");
			}
			await recorder.flush();
			const recordedCount = record.mock.calls.length;
			const sentCount = send.mock.calls.length;
			const read = () => transcript.execute({}, toolContext);
			const expected = await read();
			expect(expected).toMatchObject({
				entries: [{ sessionId: "helper-session", text: "ORANGES", seq: 1 }],
				latestSeq: 1,
			});
			started.destroyConnections();
			await new Promise<void>((resolve) =>
				started.server.close(() => resolve()),
			);
			server = undefined;
			for (let index = 0; index < 10; index++) {
				await expect(read()).resolves.toEqual(expected);
			}
			await expect(
				transcript.execute({ sinceSeq: 1 }, toolContext),
			).resolves.toEqual({ entries: [], latestSeq: 1 });
			await recorder.flush();
			expect(record).toHaveBeenCalledTimes(recordedCount);
			expect(send).toHaveBeenCalledTimes(sentCount);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			record.mockRestore();
			send.mockRestore();
			fetch.mockRestore();
			await result.dispose();
		}
	});

	it("emits helper progress as a driver steer message", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;
		let helperTools: AgentTool[] | undefined;
		createCliCoreMock.mockResolvedValue({
			start: vi.fn(async ({ config }: { config: { extraTools: unknown } }) => {
				helperTools = config.extraTools as AgentTool[];
				return { sessionId: "helper-session" };
			}),
			send: vi.fn(() => new Promise(() => {})),
			abort: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		});
		const emitSteerMessage = vi.fn();
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			emitSteerMessage,
			env: { CLINE_COMPUTER_USE_PORT: String(started.port) },
		});
		if (!result) throw new Error("computer user was not configured");
		const start = result.driverTools.find(
			(tool) => tool.name === "computer_user_start",
		);
		await start?.execute({ task: "inspect" }, toolContext);
		const update = helperTools?.find(
			(tool) => tool.name === "post_driver_update",
		);
		if (!update) throw new Error("missing helper update tool");

		await update.execute(
			{ kind: "progress", message: "opened the dashboard" },
			toolContext,
		);

		expect(emitSteerMessage).toHaveBeenCalledWith(
			"[COMPUTER USER PROGRESS] opened the dashboard",
		);
		await result.dispose();
	});

	it("keeps transcript session identities across helper replacement", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;
		const hooks: AgentHooks[] = [];
		createCliCoreMock.mockResolvedValue({
			start: vi.fn(async ({ config }: { config: { hooks: AgentHooks } }) => {
				hooks.push(config.hooks);
				return { sessionId: `helper-${hooks.length}` };
			}),
			send: vi.fn(async () => makeResult()),
			abort: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		});
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			emitSteerMessage: () => {},
			env: { CLINE_COMPUTER_USE_PORT: String(started.port) },
		});
		expect(result).toBeDefined();
		if (!result) throw new Error("computer user was not configured");
		const tool = (name: string) => {
			const found = result.driverTools.find((tool) => tool.name === name);
			if (!found) throw new Error(`missing tool ${name}`);
			return found;
		};
		const recordMessage = (hook: AgentHooks, text: string) =>
			hook.onEvent?.({
				type: "message-added",
				snapshot: { agentId: "helper-agent" } as never,
				message: {
					id: text,
					role: "assistant",
					content: [{ type: "text", text }],
					createdAt: 0,
				},
			});
		try {
			await tool("computer_user_start").execute({ task: "first" }, toolContext);
			await recordMessage(hooks[0], "first");
			await tool("computer_user_restart").execute({}, toolContext);
			await tool("computer_user_start").execute(
				{ task: "second" },
				toolContext,
			);
			await recordMessage(hooks[1], "second");
			expect(hooks[0].beforeModel).toBeTypeOf("function");
			expect(hooks[1].beforeModel).toBeTypeOf("function");
			expect(hooks[0].beforeModel).not.toBe(hooks[1].beforeModel);
			// Construction and enqueueing do not capture. The runtime hook does
			// that only when the instruction reaches the next model boundary.
			expect(started.actions).not.toContain("screenshot");
			const message: AgentMessage = {
				id: "instruction",
				role: "user",
				createdAt: 0,
				content: [{ type: "text", text: "inspect" }],
			};
			const snapshot: AgentRuntimeStateSnapshot = {
				agentId: "helper-agent",
				runId: "run",
				status: "running",
				iteration: 1,
				messages: [message],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			};
			const observed = await hooks[1].beforeModel?.({
				snapshot,
				request: { messages: [message], tools: [] },
			});
			expect(observed?.messages?.at(-1)?.content).toEqual([
				{
					type: "text",
					text: expect.stringContaining('"executable":"editor.exe"'),
				},
				{
					type: "image",
					image: "c2NyZWVu",
					mediaType: "image/png",
					source: "computer",
				},
			]);
			expect(
				started.actions.filter((action) => action === "screenshot"),
			).toHaveLength(1);
			await recordMessage(hooks[0], "late first");
			const transcript = await tool("computer_user_transcript").execute(
				{},
				toolContext,
			);
			expect(transcript).toMatchObject({
				entries: [
					{ sessionId: "helper-1", text: "first" },
					{ sessionId: "helper-2", text: "second" },
					{ sessionId: "helper-1", text: "late first" },
				],
			});
		} finally {
			await result.dispose();
		}
	});

	it("starts the helper with the shared prompt and one moderate adaptive reasoning snapshot", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;
		const start = vi.fn(
			async (_input: {
				config: Record<string, unknown>;
				interactive: boolean;
			}) => ({ sessionId: "helper-session" }),
		);
		const send = vi.fn(() => new Promise(() => {}));
		createCliCoreMock.mockResolvedValue({
			start,
			send,
			abort: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		});
		const driverConfig = {
			...makeConfig(),
			thinking: true,
			reasoningEffort: "high" as const,
		};

		const result = await createInteractiveComputerUser({
			config: driverConfig,
			providerSettingsManager: makeSettings({
				provider: "anthropic",
				apiKey: "sk-ant-x",
				model: "claude-sonnet-4-5",
				client: "openai",
				protocol: "openai-responses",
				routingProviderId: "openai-native",
				reasoning: {
					enabled: true,
					effort: "low",
					budgetTokens: 8192,
				},
			}),
			emitSteerMessage: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
				CLINE_COMPUTER_USER_MODEL: "anthropic/claude-sonnet-5",
			} as NodeJS.ProcessEnv,
		});
		const startTool = result?.driverTools.find(
			(tool) => tool.name === "computer_user_start",
		);

		await startTool?.execute({ task: "inspect the desktop" }, toolContext);

		expect(start).toHaveBeenCalledWith({
			interactive: true,
			config: expect.objectContaining({
				systemPrompt: COMPUTER_USER_SYSTEM_PROMPT,
				providerId: "anthropic",
				modelId: "claude-sonnet-5",
				thinking: true,
				reasoningEffort: "medium",
				providerConfig: expect.objectContaining({
					providerId: "anthropic",
					modelId: "claude-sonnet-5",
					thinking: true,
					reasoningEffort: "medium",
					clientType: undefined,
					routingProviderId: undefined,
					thinkingBudgetTokens: undefined,
					knownModels: expect.objectContaining({
						"claude-sonnet-5": expect.objectContaining({
							reasoningOptions: [
								{
									type: "effort",
									values: ["low", "medium", "high", "xhigh", "max"],
								},
							],
						}),
					}),
				}),
			}),
		});
		expect(start.mock.calls[0]?.[0]?.config).not.toHaveProperty(
			"thinkingBudgetTokens",
		);
		expect(driverConfig).toMatchObject({
			thinking: true,
			reasoningEffort: "high",
		});
		await result?.dispose();
	});

	it("shields abort rejections until the helper run is quiescent", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;
		let resolveSend: ((result: AgentResult) => void) | undefined;
		const send = vi.fn(
			() =>
				new Promise<AgentResult>((resolve) => {
					resolveSend = resolve;
				}),
		);
		const abort = vi.fn(async () => {});
		createCliCoreMock.mockResolvedValue({
			start: vi.fn(async () => ({ sessionId: "helper-session" })),
			send,
			abort,
			stop: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		});
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			emitSteerMessage: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
			} as NodeJS.ProcessEnv,
		});
		const byName = new Map(
			result?.driverTools.map((tool) => [tool.name, tool]) ?? [],
		);
		await byName
			.get("computer_user_start")
			?.execute({ task: "inspect the desktop" }, toolContext);

		let stopped = false;
		const interruption = byName
			.get("computer_user_interrupt")
			?.execute({ reason: "no progress" }, toolContext) as Promise<unknown>;
		const observedInterruption = interruption.then((output) => {
			stopped = true;
			return output;
		});

		await vi.waitFor(() => {
			expect(abort).toHaveBeenCalledWith(
				"helper-session",
				expect.objectContaining({ message: "no progress" }),
			);
		});
		expect(acquireAbortRejectionShieldMock).toHaveBeenCalledTimes(1);
		expect(releaseAbortRejectionShieldMock).not.toHaveBeenCalled();
		expect(stopped).toBe(false);

		resolveSend?.(makeResult({ finishReason: "aborted" }));
		await expect(observedInterruption).resolves.toMatchObject({
			status: "stopped",
		});
		expect(releaseAbortRejectionShieldMock).toHaveBeenCalledTimes(1);
		await result?.dispose();
	});
});

describe("withHelperReasoningControls", () => {
	it("declares adaptive effort controls for the helper model", () => {
		const result = withHelperReasoningControls(undefined, "claude-sonnet-5");
		expect(result["claude-sonnet-5"]).toEqual({
			id: "claude-sonnet-5",
			reasoningOptions: [
				{
					type: "effort",
					values: ["low", "medium", "high", "xhigh", "max"],
				},
			],
		});
	});

	it("preserves other catalog entries and the helper model's own facts", () => {
		const result = withHelperReasoningControls(
			{
				"claude-sonnet-5": {
					id: "claude-sonnet-5",
					name: "Claude Sonnet 5",
					contextWindow: 1000000,
				},
				"claude-opus-4-7": { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
			},
			"claude-sonnet-5",
		);
		expect(result["claude-sonnet-5"]).toMatchObject({
			name: "Claude Sonnet 5",
			contextWindow: 1000000,
		});
		expect(result["claude-opus-4-7"]).toEqual({
			id: "claude-opus-4-7",
			name: "Claude Opus 4.7",
		});
	});
});

describe("resolveHelperModelId", () => {
	it("prefers CLINE_COMPUTER_USER_MODEL over saved provider model", () => {
		expect(
			resolveHelperModelId({ model: "claude-sonnet-4-6" }, {
				CLINE_COMPUTER_USER_MODEL: "claude-opus-4-7",
			} as NodeJS.ProcessEnv),
		).toBe("claude-opus-4-7");
	});

	it("removes the redundant namespace for the direct Anthropic provider", () => {
		expect(
			resolveHelperModelId(undefined, {
				CLINE_COMPUTER_USER_MODEL: "anthropic/claude-sonnet-5",
			} as NodeJS.ProcessEnv),
		).toBe("claude-sonnet-5");
	});

	it("falls back to the Anthropic provider entry's saved model", () => {
		expect(
			resolveHelperModelId(
				{ model: "claude-haiku-4-5" },
				{} as NodeJS.ProcessEnv,
			),
		).toBe("claude-haiku-4-5");
	});

	it("defaults when neither env nor settings specify a model", () => {
		expect(resolveHelperModelId(undefined, {} as NodeJS.ProcessEnv)).toBe(
			"claude-sonnet-4-6",
		);
		expect(
			resolveHelperModelId({ model: "  " }, {
				CLINE_COMPUTER_USER_MODEL: " ",
			} as NodeJS.ProcessEnv),
		).toBe("claude-sonnet-4-6");
	});
});
