import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "./message-id-minter"
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

		coordinator.appendMessages(messages)

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
		coordinator.appendAndEmit(messages, event as any)

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

	it("drops the full request body from api_req_started messages, keeping only metadata", () => {
		const coordinator = new SdkMessageCoordinator({ getTask: () => undefined })
		const hugeRequestBody = JSON.stringify({
			system: "you are a helpful assistant",
			messages: Array.from({ length: 3000 }, (_, i) => ({ role: "user", content: `message ${i} ${"x".repeat(20)}` })),
		})
		expect(hugeRequestBody.length).toBeGreaterThan(40_000)
		const finalized = coordinator.finalizeMessagesForSave([
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: hugeRequestBody, tokensIn: 100, tokensOut: 50, cost: 0.1 }),
				partial: false,
			},
		])

		const info = JSON.parse(finalized[0].text ?? "{}") as { request?: string; tokensIn?: number; cost?: number }
		expect(info.request).toBeUndefined()
		expect(info.tokensIn).toBe(100)
		expect(info.cost).toBe(0.1)
		// The metadata-only text must be small; the 40KB+ body must not reach the webview.
		expect((finalized[0].text ?? "").length).toBeLessThan(500)
	})

	it("drops the request body even when stamping a cancel reason on an unfinished api_req", () => {
		const coordinator = new SdkMessageCoordinator({ getTask: () => undefined })
		const finalized = coordinator.finalizeMessagesForSave([
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "x".repeat(45_000) }),
				partial: false,
			},
		])

		const info = JSON.parse(finalized[0].text ?? "{}") as { request?: string; cancelReason?: string }
		expect(info.request).toBeUndefined()
		expect(info.cancelReason).toBe("user_cancelled")
	})

	it("finalizes partial ask messages so their streaming state is never rendered as pending", () => {
		const coordinator = new SdkMessageCoordinator({ getTask: () => undefined })
		const finalized = coordinator.finalizeMessagesForSave([
			{ ts: 1, type: "ask", ask: "tool", text: "mid-stream tool call", partial: true },
		])

		expect(finalized[0].partial).toBeUndefined()
		expect(finalized[0].type).toBe("ask")
		expect(finalized[0].ask).toBe("tool")
	})

	it("stamps seq and epoch from the shared minter on append", () => {
		const minter = new MessageIdMinter()
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task, getMinter: () => minter })

		const a: ClineMessage = { ts: 1, type: "say" as const, say: "text" as const, text: "a", partial: true }
		const b: ClineMessage = { ts: 2, type: "say" as const, say: "text" as const, text: "b", partial: false }
		coordinator.appendMessages([a, b])

		// Both got the current epoch, and seq strictly increases in append order.
		expect(a.epoch).toBe(0)
		expect(b.epoch).toBe(0)
		expect(typeof a.seq).toBe("number")
		expect((b.seq ?? 0) > (a.seq ?? 0)).toBe(true)
	})

	it("gives an updated message a NEWER seq than its earlier copy (partial -> final)", () => {
		const minter = new MessageIdMinter()
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task, getMinter: () => minter })

		const partial: ClineMessage = { ts: 10, type: "say" as const, say: "text" as const, text: "Hel", partial: true }
		coordinator.appendMessages([partial])
		const partialSeq = partial.seq ?? 0

		// A new copy with the SAME ts (identity) passes through again on finalize.
		const final: ClineMessage = { ts: 10, type: "say" as const, say: "text" as const, text: "Hello", partial: false }
		coordinator.appendMessages([final])

		expect((final.seq ?? 0) > partialSeq).toBe(true)
	})

	it("reflects a bumped epoch on subsequent messages", () => {
		const minter = new MessageIdMinter()
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task, getMinter: () => minter })

		const before: ClineMessage = { ts: 1, type: "say" as const, say: "text" as const, text: "before", partial: false }
		coordinator.appendMessages([before])
		minter.bumpEpoch()
		const after: ClineMessage = { ts: 2, type: "say" as const, say: "text" as const, text: "after", partial: false }
		coordinator.appendMessages([after])

		expect(before.epoch).toBe(0)
		expect(after.epoch).toBe(1)
	})

	it("leaves messages unstamped when no minter is wired (classic/legacy)", () => {
		const task = createTaskProxy("session-123", vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({ getTask: () => task })
		const m: ClineMessage = { ts: 1, type: "say" as const, say: "text" as const, text: "x", partial: false }
		coordinator.appendMessages([m])
		expect(m.seq).toBeUndefined()
		expect(m.epoch).toBeUndefined()
	})
})
