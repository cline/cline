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
		["aborted", "idle"],
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
		expect(host.status).toBe("idle")
	})
})
