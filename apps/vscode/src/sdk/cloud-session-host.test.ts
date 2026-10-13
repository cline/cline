import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SdkSessionHost } from "./session-host"

const runtime = vi.hoisted(() => ({
	listeners: [] as Array<(event: unknown) => void>,
	runTurn: vi.fn(),
	pendingList: vi.fn(),
	pendingUpdate: vi.fn(),
	pendingDelete: vi.fn(),
	listSessions: vi.fn(),
	updateSessionConnection: vi.fn(),
	readSessionMessages: vi.fn(),
	startSession: vi.fn(async (input: { config: { sessionId: string } }) => ({ sessionId: input.config.sessionId })),
}))

vi.mock("@cline/core", () => ({
	RemoteRuntimeHost: class {
		pendingPrompts = { list: runtime.pendingList, update: runtime.pendingUpdate, delete: runtime.pendingDelete }
		connect = vi.fn(async () => undefined)
		listSessions = runtime.listSessions
		updateSessionConnection = runtime.updateSessionConnection
		readSessionMessages = runtime.readSessionMessages
		startSession = runtime.startSession
		subscribe(listener: (event: unknown) => void) {
			runtime.listeners.push(listener)
			return vi.fn()
		}
		runTurn = runtime.runTurn
		dispose = vi.fn(async () => undefined)
	},
}))

const { CloudSessionHost, mapAgentFinishReason } = await import("./cloud-session-host")

describe("CloudSessionHost status", () => {
	beforeEach(() => {
		runtime.listeners.length = 0
		runtime.runTurn.mockReset()
		runtime.pendingList.mockReset().mockResolvedValue([])
		runtime.pendingUpdate.mockReset()
		runtime.pendingDelete.mockReset()
		runtime.listSessions.mockReset().mockResolvedValue([{ sessionId: "inner-session", status: "idle" }])
		runtime.updateSessionConnection.mockReset().mockResolvedValue(undefined)
		runtime.readSessionMessages.mockReset().mockResolvedValue([])
		runtime.startSession.mockClear()
	})

	it("rebuilds the runtime a resumed sandbox lost from its saved conversation before the first turn", async () => {
		const saved = [{ role: "user", content: "first prompt" }]
		runtime.updateSessionConnection.mockRejectedValueOnce(
			Object.assign(new Error("session not found: inner-session"), { code: "session_not_found" }),
		)
		runtime.readSessionMessages.mockResolvedValue(saved)
		runtime.runTurn.mockResolvedValue({ finishReason: "completed" })
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
			restoreConfig: async () => ({ providerId: "cline", modelId: "sandbox-model", systemPrompt: "guidance" }) as never,
		})

		await host.send({ sessionId: "ses-outer", prompt: "follow-up" })
		await host.send({ sessionId: "ses-outer", prompt: "another" })

		expect(runtime.startSession).toHaveBeenCalledOnce()
		expect(runtime.startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				initialMessages: saved,
				config: expect.objectContaining({ sessionId: "inner-session", modelId: "sandbox-model" }),
				toolPolicies: { "*": { enabled: true, autoApprove: true } },
			}),
		)
		expect(runtime.updateSessionConnection).toHaveBeenCalledOnce()
		expect(runtime.runTurn).toHaveBeenCalledTimes(2)
	})

	it("leaves a live runtime alone and surfaces other probe failures", async () => {
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
			restoreConfig: async () => ({ providerId: "cline", modelId: "sandbox-model" }) as never,
		})
		runtime.updateSessionConnection.mockRejectedValueOnce(new Error("connection closed"))
		await expect(host.send({ sessionId: "ses-outer", prompt: "follow-up" })).rejects.toThrow("connection closed")
		expect(runtime.runTurn).not.toHaveBeenCalled()

		runtime.runTurn.mockResolvedValue({ finishReason: "completed" })
		await host.send({ sessionId: "ses-outer", prompt: "follow-up" })
		expect(runtime.startSession).not.toHaveBeenCalled()
		expect(runtime.runTurn).toHaveBeenCalledOnce()
	})

	it.each([
		["completed", "completed"],
		["aborted", "cancelled"],
		["error", "failed"],
		["max_iterations", "failed"],
		["mistake_limit", "failed"],
	] as const)("maps %s to %s", (reason, expected) => {
		expect(mapAgentFinishReason(reason)).toBe(expected)
	})

	it("sends every turn in Act mode even when the caller asks for Plan", async () => {
		runtime.runTurn.mockResolvedValue({ finishReason: "completed" })
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
		})

		await host.send({ sessionId: "ses-outer", prompt: "continue", mode: "plan" })

		expect(runtime.runTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "inner-session", mode: "act" }))
	})

	it("subscribes to the task it discovers so a completion by another client is seen", async () => {
		runtime.listSessions.mockResolvedValue([{ sessionId: "inner-session", status: "running" }])
		runtime.pendingList.mockResolvedValue([])
		const onStatusChange = vi.fn()
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
			onStatusChange,
		})
		expect(host.status).toBe("running")
		// A status-only connection has sent no command for this task; the Hub
		// only streams a session's events to clients subscribed to it.
		expect(runtime.pendingList).toHaveBeenCalledWith({ sessionId: "inner-session" })

		for (const listener of runtime.listeners) {
			listener({ type: "ended", payload: { sessionId: "inner-session", reason: "completed" } })
		}

		expect(host.status).toBe("completed")
		expect(onStatusChange).toHaveBeenCalledWith("completed")
	})

	it("does not claim to change the model the sandbox runs on", async () => {
		runtime.listSessions.mockResolvedValue([])
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
		})
		await host.start({ config: { providerId: "cline", modelId: "sandbox-model" }, interactive: true } as never)

		// The Hub protocol has no command to change a running session's model,
		// so the lifecycle must see no capability and the composer must keep
		// naming the model the sandbox was started on.
		expect((host as SdkSessionHost).updateSessionModel).toBeUndefined()
		expect(host.sessionModelId).toBe("sandbox-model")
	})

	it("refreshes a retained host without letting an older snapshot overwrite a live event", async () => {
		runtime.listSessions.mockResolvedValueOnce([{ sessionId: "inner-session", status: "completed" }])
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1",
			getAuthToken: async () => "token",
		})
		let resolve!: (sessions: unknown[]) => void
		runtime.listSessions.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done
			}),
		)
		const refreshing = host.refreshStatus()
		for (const listener of runtime.listeners)
			listener({ type: "status", payload: { sessionId: "inner-session", status: "running" } })
		resolve([{ sessionId: "inner-session", status: "completed" }])
		expect(await refreshing).toBe("running")
		runtime.listSessions.mockResolvedValueOnce([{ sessionId: "inner-session", status: "completed" }])
		expect(await host.refreshStatus()).toBe("completed")
		runtime.listSessions.mockRejectedValueOnce(new Error("offline"))
		await expect(host.refreshStatus()).rejects.toThrow("offline")
		expect(host.status).toBe("unknown")
		await host.dispose()
	})

	it("leaves running state when runTurn rejects without a terminal event", async () => {
		const error = new Error("connection closed")
		runtime.runTurn.mockRejectedValue(error)
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
		})

		await expect(host.send({ sessionId: "ses-outer", prompt: "continue" })).rejects.toBe(error)
		expect(host.status).toBe("unknown")
	})

	it.each(["update", "delete"] as const)("maps pending-prompt %s across the cloud id boundary", async (action) => {
		const mutate = action === "update" ? runtime.pendingUpdate : runtime.pendingDelete
		mutate.mockResolvedValue({ sessionId: "inner-session", prompts: [] })
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			taskId: "inner-session",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
		})
		const input = { sessionId: "ses-outer", promptId: "prompt-1" }

		const result =
			action === "update" ? await host.pendingPrompts("update", input) : await host.pendingPrompts("delete", input)

		expect(mutate).toHaveBeenCalledWith({ ...input, sessionId: "inner-session" })
		expect(result).toEqual({ sessionId: "ses-outer", prompts: [] })
	})

	it.each([
		"completed",
		"aborted",
		"error",
		"max_iterations",
		"mistake_limit",
	] as const)("preserves %s across both idle/done orderings and a late RPC rejection", async (reason) => {
		for (const idleFirst of [false, true]) {
			let reject!: (error: Error) => void
			runtime.runTurn.mockImplementationOnce(
				() =>
					new Promise((_resolve, fail) => {
						reject = fail
					}),
			)
			const host = await CloudSessionHost.connect({
				outerSessionId: "ses-outer",
				taskId: "inner-session",
				socketUrl: "ws://127.0.0.1:1",
				getAuthToken: async () => "token",
			})
			const sending = host.send({ sessionId: "ses-outer", prompt: "continue" })
			const idle = { type: "status", payload: { sessionId: "inner-session", status: "idle" } }
			const done = { type: "agent_event", payload: { sessionId: "inner-session", event: { type: "done", reason } } }
			for (const event of idleFirst ? [idle, done] : [done, idle]) {
				for (const listener of runtime.listeners) listener(event)
			}
			reject(new Error("reply lost"))
			await expect(sending).rejects.toThrow("reply lost")
			expect(host.status).toBe(mapAgentFinishReason(reason))
			await host.dispose()
		}
	})
})
