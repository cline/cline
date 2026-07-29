import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import type { AgentResult, AgentToolContext } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	createInteractiveComputerUser,
	resolveHelperModelId,
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
}> {
	const sockets = new Set<Socket>();
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
						const request = JSON.parse(line) as { id: number };
						socket.write(
							`${JSON.stringify({
								id: request.id,
								ok: true,
								display: { widthPx: 1920, heightPx: 1080 },
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
			notifyDriver: () => {},
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
			notifyDriver: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
			} as NodeJS.ProcessEnv,
		});
		expect(result).toBeUndefined();
	});

	it("exposes the four driver tools when enabled and configured", async () => {
		const started = await startStubBackend();
		server = started.server;
		destroyConnections = started.destroyConnections;

		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({
				apiKey: "sk-ant-x",
				model: "claude-sonnet-4-6",
			}),
			notifyDriver: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
			} as NodeJS.ProcessEnv,
		});
		expect(result).toBeDefined();
		expect(result?.driverTools.map((tool) => tool.name).sort()).toEqual([
			"computer_user_interrupt",
			"computer_user_message",
			"computer_user_start",
			"computer_user_status",
		]);
		// The raw computer tool must not be among the driver's tools.
		expect(result?.driverTools.some((tool) => tool.name === "computer")).toBe(
			false,
		);
		await result?.dispose();
	});

	it("starts the helper with one adaptive reasoning snapshot", async () => {
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

		const result = await createInteractiveComputerUser({
			config: makeConfig(),
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
			notifyDriver: () => {},
			env: {
				CLINE_COMPUTER_USE_PORT: String(started.port),
				CLINE_COMPUTER_USER_MODEL: "claude-opus-4-7",
			} as NodeJS.ProcessEnv,
		});
		const startTool = result?.driverTools.find(
			(tool) => tool.name === "computer_user_start",
		);

		await startTool?.execute({ task: "inspect the desktop" }, toolContext);

		expect(start).toHaveBeenCalledWith({
			interactive: true,
			config: expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-opus-4-7",
				thinking: true,
				reasoningEffort: "high",
				providerConfig: expect.objectContaining({
					providerId: "anthropic",
					modelId: "claude-opus-4-7",
					thinking: true,
					reasoningEffort: "high",
					clientType: undefined,
					routingProviderId: undefined,
					thinkingBudgetTokens: undefined,
				}),
			}),
		});
		expect(start.mock.calls[0]?.[0]?.config).not.toHaveProperty(
			"thinkingBudgetTokens",
		);
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
			notifyDriver: () => {},
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

describe("resolveHelperModelId", () => {
	it("prefers CLINE_COMPUTER_USER_MODEL over saved provider model", () => {
		expect(
			resolveHelperModelId({ model: "claude-sonnet-4-6" }, {
				CLINE_COMPUTER_USER_MODEL: "claude-opus-4-7",
			} as NodeJS.ProcessEnv),
		).toBe("claude-opus-4-7");
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
