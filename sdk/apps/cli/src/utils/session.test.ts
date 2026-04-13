import type { AgentEvent } from "@clinebot/core";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const resolveSessionBackend = vi.fn();
const ensureRpcRuntimeAddress = vi.fn();
const mockGetRpcServerHealth = vi.fn();

// Controllable mock for RpcSessionClient used across all tests.
let mockStreamEventsHandler:
	| ((event: { eventType: string; payload: Record<string, unknown> }) => void)
	| undefined;
const mockStartRuntimeSession = vi.fn();
const mockSendRuntimeSession = vi.fn();
const mockGetSession = vi.fn();
const mockClientClose = vi.fn();
const mockStopStreaming = vi.fn();

class MockRpcCoreSessionService {
	updateSessionStatus = vi.fn();
}

vi.mock("@clinebot/core", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/core")>("@clinebot/core");
	return {
		...actual,
		RpcCoreSessionService: MockRpcCoreSessionService as unknown,
		resolveSessionBackend,
		ClineCore: {
			create: vi.fn(),
		},
	};
});

vi.mock("@clinebot/rpc", () => ({
	RPC_BUILD_VERSION: "rpc-build-test",
	getRpcServerDefaultAddress: vi.fn(() => "127.0.0.1:4317"),
	getRpcServerHealth: mockGetRpcServerHealth,
	RpcSessionClient: vi.fn().mockImplementation(function RpcSessionClient() {
		return {
			close: mockClientClose,
			streamEvents: vi.fn(
				(
					_opts: unknown,
					callbacks: { onEvent: typeof mockStreamEventsHandler },
				) => {
					mockStreamEventsHandler = callbacks.onEvent;
					return mockStopStreaming;
				},
			),
			startRuntimeSession: mockStartRuntimeSession,
			sendRuntimeSession: mockSendRuntimeSession,
			getSession: mockGetSession,
			stopRuntimeSession: vi.fn(),
			abortRuntimeSession: vi.fn(),
		};
	}),
}));

vi.mock("../commands/rpc", () => ({
	ensureRpcRuntimeAddress,
}));

vi.mock("./telemetry", () => ({
	getCliTelemetryService: vi.fn(() => undefined),
}));

describe("createDefaultCliSessionManager", () => {
	let createDefaultCliSessionManager: typeof import("./session").createDefaultCliSessionManager;
	const envSnapshot = {
		CLINE_RPC_ADDRESS: process.env.CLINE_RPC_ADDRESS,
		CLINE_SESSION_BACKEND_MODE: process.env.CLINE_SESSION_BACKEND_MODE,
	};

	beforeAll(async () => {
		({ createDefaultCliSessionManager } = await import("./session"));
	});

	beforeEach(() => {
		resolveSessionBackend.mockReset();
		ensureRpcRuntimeAddress.mockReset();
		mockGetRpcServerHealth.mockReset();
		resolveSessionBackend.mockResolvedValue(new MockRpcCoreSessionService());
		delete process.env.CLINE_RPC_ADDRESS;
		delete process.env.CLINE_SESSION_BACKEND_MODE;
	});

	afterEach(() => {
		process.env.CLINE_RPC_ADDRESS = envSnapshot.CLINE_RPC_ADDRESS;
		process.env.CLINE_SESSION_BACKEND_MODE =
			envSnapshot.CLINE_SESSION_BACKEND_MODE;
	});

	it("treats an explicit rpc address as a shared server to attach to", async () => {
		process.env.CLINE_RPC_ADDRESS = "127.0.0.1:5001";

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "rpc",
			rpc: { address: "127.0.0.1:5001", autoStart: false },
		});
	});

	it("connects to the default rpc address in auto mode when a server is already running", async () => {
		mockGetRpcServerHealth.mockResolvedValue({
			running: true,
			serverId: "auto-discovered-server",
		});

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(mockGetRpcServerHealth).toHaveBeenCalledWith("127.0.0.1:4317");
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "rpc",
			rpc: { address: "127.0.0.1:4317", autoStart: false },
		});
	});

	it("falls back to the local backend in auto mode when no rpc server is running", async () => {
		mockGetRpcServerHealth.mockResolvedValue(undefined);

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(mockGetRpcServerHealth).toHaveBeenCalledWith("127.0.0.1:4317");
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("falls back to the local backend in auto mode when the rpc health probe throws", async () => {
		mockGetRpcServerHealth.mockRejectedValue(new Error("connection refused"));

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("uses the local backend by default when no explicit rpc address is configured and no server is running", async () => {
		mockGetRpcServerHealth.mockResolvedValue(undefined);

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});
});

// ---------------------------------------------------------------------------
// RPC streaming text deduplication
// ---------------------------------------------------------------------------

describe("RPC session streaming text deduplication", () => {
	let createDefaultCliSessionManager: typeof import("./session").createDefaultCliSessionManager;
	const SESSION_ID = "test-session-1";

	const envSnapshot = {
		CLINE_RPC_ADDRESS: process.env.CLINE_RPC_ADDRESS,
		CLINE_SESSION_BACKEND_MODE: process.env.CLINE_SESSION_BACKEND_MODE,
	};

	beforeAll(async () => {
		({ createDefaultCliSessionManager } = await import("./session"));
	});

	beforeEach(() => {
		resolveSessionBackend.mockReset();
		ensureRpcRuntimeAddress.mockReset();
		mockGetRpcServerHealth.mockReset();
		mockStartRuntimeSession.mockReset();
		mockSendRuntimeSession.mockReset();
		mockGetSession.mockReset();
		mockStopStreaming.mockReset();
		mockStreamEventsHandler = undefined;

		// Force the RPC backend path.
		resolveSessionBackend.mockResolvedValue(new MockRpcCoreSessionService());
		process.env.CLINE_RPC_ADDRESS = "127.0.0.1:5001";

		// Minimal start/getSession responses.
		mockStartRuntimeSession.mockResolvedValue({
			sessionId: SESSION_ID,
			startResult: undefined,
		});
		mockGetSession.mockResolvedValue({
			sessionId: SESSION_ID,
			source: "cli",
			pid: process.pid,
			startedAt: new Date().toISOString(),
			status: "running",
			interactive: false,
			provider: "test",
			model: "test-model",
			cwd: process.cwd(),
			workspaceRoot: process.cwd(),
		});
	});

	afterEach(() => {
		process.env.CLINE_RPC_ADDRESS = envSnapshot.CLINE_RPC_ADDRESS;
		process.env.CLINE_SESSION_BACKEND_MODE =
			envSnapshot.CLINE_SESSION_BACKEND_MODE;
	});

	/** Helper: create a session manager and start a session so send() can work. */
	async function setupSession() {
		const manager = await createDefaultCliSessionManager();
		await manager.start({
			config: {
				sessionId: SESSION_ID,
				cwd: process.cwd(),
				workspaceRoot: process.cwd(),
				providerId: "test",
				modelId: "test-model",
				mode: "agent",
				systemPrompt: "",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		} as unknown as Parameters<typeof manager.start>[0]);
		return manager;
	}

	/** Collect all content_start text events emitted by the session manager. */
	function collectTextEvents(
		manager: Awaited<ReturnType<typeof setupSession>>,
	) {
		const textEvents: { type: string; text?: string }[] = [];
		manager.subscribe((event: unknown) => {
			const e = event as {
				type: string;
				payload: { event: AgentEvent };
			};
			if (
				e.payload?.event?.type === "content_start" &&
				(e.payload.event as AgentEvent & { contentType?: string })
					.contentType === "text"
			) {
				textEvents.push({
					type: "content_start",
					text: (e.payload.event as AgentEvent & { text?: string }).text,
				});
			}
		});
		return textEvents;
	}

	it("does not re-emit text that was already streamed via deltas", async () => {
		const fullText = "Hello, this is the complete response.";

		mockSendRuntimeSession.mockImplementation(async () => {
			// Simulate streaming: emit two text_delta events that build up the full text.
			mockStreamEventsHandler?.({
				eventType: "runtime.chat.text_delta",
				payload: { text: "Hello, this is ", accumulated: "Hello, this is " },
			});
			mockStreamEventsHandler?.({
				eventType: "runtime.chat.text_delta",
				payload: {
					text: "the complete response.",
					accumulated: fullText,
				},
			});

			return {
				result: {
					text: fullText,
					finishReason: "end_turn",
					iterations: 1,
					usage: { inputTokens: 10, outputTokens: 20 },
					messages: [],
					toolCalls: [],
				},
			};
		});

		const manager = await setupSession();
		const textEvents = collectTextEvents(manager);

		await manager.send({ sessionId: SESSION_ID, prompt: "hi" });

		// Each piece of text should appear exactly once — two streaming chunks, no duplication.
		expect(textEvents).toEqual([
			{ type: "content_start", text: "Hello, this is " },
			{ type: "content_start", text: "the complete response." },
		]);
	});

	it("does not re-emit full text when streamed text diverges from result.text", async () => {
		// Simulate a case where streamed accumulated text doesn't perfectly match result.text
		// (e.g., minor normalization differences). The old code would re-emit the entire text.
		const streamedVersion = "Response with trailing space ";
		const resultVersion = "Response with trailing space";

		mockSendRuntimeSession.mockImplementation(async () => {
			mockStreamEventsHandler?.({
				eventType: "runtime.chat.text_delta",
				payload: { text: streamedVersion, accumulated: streamedVersion },
			});

			return {
				result: {
					text: resultVersion,
					finishReason: "end_turn",
					iterations: 1,
					usage: { inputTokens: 10, outputTokens: 20 },
					messages: [],
					toolCalls: [],
				},
			};
		});

		const manager = await setupSession();
		const textEvents = collectTextEvents(manager);

		await manager.send({ sessionId: SESSION_ID, prompt: "hi" });

		// Only the streamed delta should appear — the divergent result.text must NOT be re-emitted.
		expect(textEvents).toEqual([
			{ type: "content_start", text: streamedVersion },
		]);
	});

	it("emits result.text when nothing was streamed", async () => {
		// When no streaming deltas arrive, the final result.text should still be emitted.
		const resultText = "Non-streamed response";

		mockSendRuntimeSession.mockImplementation(async () => {
			// No streaming events fired.
			return {
				result: {
					text: resultText,
					finishReason: "end_turn",
					iterations: 1,
					usage: { inputTokens: 10, outputTokens: 20 },
					messages: [],
					toolCalls: [],
				},
			};
		});

		const manager = await setupSession();
		const textEvents = collectTextEvents(manager);

		await manager.send({ sessionId: SESSION_ID, prompt: "hi" });

		expect(textEvents).toEqual([{ type: "content_start", text: resultText }]);
	});

	it("emits only the remainder when result.text extends streamed text", async () => {
		mockSendRuntimeSession.mockImplementation(async () => {
			mockStreamEventsHandler?.({
				eventType: "runtime.chat.text_delta",
				payload: { text: "Partial ", accumulated: "Partial " },
			});

			return {
				result: {
					text: "Partial response complete.",
					finishReason: "end_turn",
					iterations: 1,
					usage: { inputTokens: 10, outputTokens: 20 },
					messages: [],
					toolCalls: [],
				},
			};
		});

		const manager = await setupSession();
		const textEvents = collectTextEvents(manager);

		await manager.send({ sessionId: SESSION_ID, prompt: "hi" });

		// The streamed chunk plus the remainder from result.text — no duplication.
		expect(textEvents).toEqual([
			{ type: "content_start", text: "Partial " },
			{ type: "content_start", text: "response complete." },
		]);
	});
});
