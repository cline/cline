import { describe, expect, it, vi } from "vitest"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

describe("SdkMessageCoordinator", () => {
	it("registers and removes session event listeners", () => {
		const coordinator = new SdkMessageCoordinator({ getTask: () => undefined })
		const listener = vi.fn()
		const event = { type: "status", payload: { sessionId: "s1", status: "running" } }
		const messages = [{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }]

		const unsubscribe = coordinator.onSessionEvent(listener)
		// biome-ignore lint/suspicious/noExplicitAny: test-only event shape
		coordinator.emitSessionEvents(messages, event as any)
		unsubscribe()
		// biome-ignore lint/suspicious/noExplicitAny: test-only event shape
		coordinator.emitSessionEvents(messages, event as any)

		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledWith(messages, event)
	})

	it("appends messages to the current task", () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task })
		const messages = [{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }]

		coordinator.appendMessages(messages, { save: false })

		expect(task.messageStateHandler.getClineMessages()).toEqual(messages)
	})

	it("appends and emits messages in order", () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task })
		const listener = vi.fn()
		const event = { type: "status", payload: { sessionId: "s1", status: "running" } }
		const messages = [{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }]

		coordinator.onSessionEvent(listener)
		// biome-ignore lint/suspicious/noExplicitAny: test-only event shape
		coordinator.appendAndEmit(messages, event as any, { save: false })

		expect(task.messageStateHandler.getClineMessages()).toEqual(messages)
		expect(listener).toHaveBeenCalledWith(messages, event)
	})

	it("finalizes partial messages and marks the last open API request as cancelled", () => {
		const coordinator = new SdkMessageCoordinator({ getTask: () => undefined })
		const finalized = coordinator.finalizeMessagesForSave([
			{ ts: 1, type: "say", say: "api_req_started", text: JSON.stringify({ cost: 0.1 }), partial: true },
			{ ts: 2, type: "say", say: "text", text: "streaming", partial: true },
			{ ts: 3, type: "say", say: "api_req_started", text: JSON.stringify({}), partial: true },
		])

		expect(finalized[0].partial).toBeUndefined()
		expect(JSON.parse(finalized[0].text ?? "{}")).toEqual({ cost: 0.1 })
		expect(finalized[1].partial).toBeUndefined()
		expect(finalized[2].partial).toBeUndefined()
		expect(JSON.parse(finalized[2].text ?? "{}")).toEqual({ cancelReason: "user_cancelled" })
	})
})
