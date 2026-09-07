import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
	listeners: [] as Array<(event: unknown) => void>,
	runTurn: vi.fn(),
}))

vi.mock("@cline/core", () => ({
	RemoteRuntimeHost: class {
		pendingPrompts = {}
		connect = vi.fn(async () => undefined)
		listSessions = vi.fn(async () => [{ sessionId: "inner-session", updatedAt: new Date().toISOString(), status: "idle" }])
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

	it("leaves running state when runTurn rejects without a terminal event", async () => {
		const error = new Error("connection closed")
		runtime.runTurn.mockRejectedValue(error)
		const host = await CloudSessionHost.connect({
			outerSessionId: "ses-outer",
			socketUrl: "ws://127.0.0.1:1/session",
			getAuthToken: async () => "token",
		})

		await expect(host.send({ sessionId: "ses-outer", prompt: "continue" })).rejects.toBe(error)
		expect(host.status).toBe("unknown")
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
