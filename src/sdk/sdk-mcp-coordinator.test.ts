import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkMcpCoordinator, type SdkMcpCoordinatorOptions } from "./sdk-mcp-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkMcpCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does nothing when MCP tools change without an active session", () => {
		const { coordinator, options } = makeCoordinator()

		coordinator.handleToolListChanged()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()
	})

	it("defers MCP restart while the active session is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleToolListChanged()

		expect(options.sessions.replaceActiveSession).not.toHaveBeenCalled()

		activeSession.isRunning = false
		coordinator.checkDeferredRestart()

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
	})

	it("restarts immediately when MCP tools change while the active session is idle", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		coordinator.handleToolListChanged()

		await vi.waitFor(() => expect(options.sessions.replaceActiveSession).toHaveBeenCalledOnce())
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "info",
					text: "MCP tools changed - reloading tools for this session...",
				}),
			],
			{ type: "status", payload: { sessionId: "old-session", status: "running" } },
		)
	})

	it("rebuilds the active session with the current mode and preserved messages", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession, mode: "plan" })

		await coordinator.restartSessionForMcpTools()

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "plan" })
		expect(options.loadInitialMessages).toHaveBeenCalledWith(activeSession.sessionManager, "old-session")
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "old-session" }), {
			cwd: "/workspace",
			mode: "plan",
		})
		expect(options.sessions.replaceActiveSession).toHaveBeenCalledWith({
			startInput: { prompt: "start" },
			initialMessages: [{ role: "user", content: "hello" }],
			disposeReason: "mcpToolRestart",
		})
		expect(options.messages.appendAndEmit).toHaveBeenLastCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "info",
					text: "MCP tools reloaded successfully. You can continue your conversation.",
				}),
				expect.objectContaining({ type: "ask", ask: "completion_result" }),
			],
			{ type: "status", payload: { sessionId: "new-session", status: "idle" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("emits an error message when restart fails", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		options.sessions.replaceActiveSession.mockRejectedValue(new Error("boom"))

		await coordinator.restartSessionForMcpTools()

		expect(options.messages.appendAndEmit).toHaveBeenLastCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "error",
					text: "Failed to reload MCP tools: boom. MCP tools may be outdated.",
				}),
			],
			{ type: "status", payload: { sessionId: "old-session", status: "error" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = input.activeSession
	const config = {
		providerId: "anthropic",
		modelId: "claude",
		apiKey: "key",
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			replaceActiveSession: vi.fn().mockResolvedValue({
				startResult: { sessionId: "new-session" },
				sessionManager: { send: vi.fn() },
			}),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkMcpCoordinatorOptions & {
		stateManager: StateManager & { getGlobalSettingsKey: ReturnType<typeof vi.fn> }
		sessions: SdkMcpCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			replaceActiveSession: ReturnType<typeof vi.fn>
		}
		messages: SdkMcpCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		sessionConfigBuilder: SdkMcpCoordinatorOptions["sessionConfigBuilder"] & { build: ReturnType<typeof vi.fn> }
		getWorkspaceRoot: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		buildStartSessionInput: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkMcpCoordinator(options),
		options,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	mode: "act" | "plan"
}

function makeActiveSession(input: { isRunning?: boolean } = {}) {
	return {
		sessionId: "old-session",
		sessionManager: {
			send: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
