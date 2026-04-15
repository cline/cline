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
const ensureCliRpcRuntimeAddress = vi.fn();

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

vi.mock("./telemetry", () => ({
	getCliTelemetryService: vi.fn(() => undefined),
}));

vi.mock("./rpc-runtime", () => ({
	ensureCliRpcRuntimeAddress,
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
		resolveSessionBackend.mockResolvedValue(new MockRpcCoreSessionService());
		ensureCliRpcRuntimeAddress.mockReset();
		ensureCliRpcRuntimeAddress.mockResolvedValue("127.0.0.1:4317");
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

		const manager = await createDefaultCliSessionManager();

		expect(resolveSessionBackend).not.toHaveBeenCalled();
		expect(manager).toBeTruthy();
	});

	it("uses rpc backend by default (no local backend or explicit address)", async () => {
		await createDefaultCliSessionManager();

		// Local backend must not be used — observable via resolveSessionBackend not being called.
		expect(resolveSessionBackend).not.toHaveBeenCalled();
		// CLINE_RPC_ADDRESS is populated so downstream code can reach the server.
		expect(process.env.CLINE_RPC_ADDRESS).toBeTruthy();
	});

	it("updates CLINE_RPC_ADDRESS when auto-start resolves a different rpc port", async () => {
		ensureCliRpcRuntimeAddress.mockResolvedValue("127.0.0.1:5317");

		await createDefaultCliSessionManager();

		expect(process.env.CLINE_RPC_ADDRESS).toBe("127.0.0.1:5317");
	});

	it("forces the local backend when requested by the caller", async () => {
		await createDefaultCliSessionManager({ forceLocalBackend: true });

		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("honors an explicit local backend override from the environment", async () => {
		process.env.CLINE_SESSION_BACKEND_MODE = "local";

		await createDefaultCliSessionManager();

		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("logs the selected backend type through the injected logger", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};

		await createDefaultCliSessionManager({ logger });

		expect(logger.log).toHaveBeenCalledWith("CLI session backend selected", {
			backendType: "rpc",
			forceLocalBackend: false,
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
