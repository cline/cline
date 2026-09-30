import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SdkSessionHost } from "./session-host"

const runtime = vi.hoisted(() => ({
	listeners: [] as Array<(event: unknown) => void>,
	runTurn: vi.fn(),
	pendingUpdate: vi.fn(),
	pendingDelete: vi.fn(),
	listSessions: vi.fn(),
}))

vi.mock("@cline/core", () => ({
	RemoteRuntimeHost: class {
		pendingPrompts = { update: runtime.pendingUpdate, delete: runtime.pendingDelete }
		connect = vi.fn(async () => undefined)
		listSessions = runtime.listSessions
		startSession = vi.fn(async (input: { config: { sessionId: string } }) => ({ sessionId: input.config.sessionId }))
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
		runtime.pendingUpdate.mockReset()
		runtime.pendingDelete.mockReset()
		runtime.listSessions.mockReset().mockResolvedValue([{ sessionId: "inner-session", status: "idle" }])
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
