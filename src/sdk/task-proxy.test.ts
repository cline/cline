import { describe, expect, it, vi } from "vitest"
import { createTaskProxy, MessageStateHandler } from "./task-proxy"

describe("MessageStateHandler", () => {
	it("should start with empty messages", () => {
		const handler = new MessageStateHandler()
		expect(handler.getClineMessages()).toEqual([])
	})

	it("should add and retrieve messages", () => {
		const handler = new MessageStateHandler()
		const messages = [
			{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false },
			{ ts: 2, type: "say" as const, say: "tool" as const, text: "tool call", partial: false },
		]
		handler.addMessages(messages)
		expect(handler.getClineMessages()).toHaveLength(2)
		expect(handler.getClineMessages()[0].text).toBe("hello")
		expect(handler.getClineMessages()[1].text).toBe("tool call")
	})

	it("should return a copy of messages", () => {
		const handler = new MessageStateHandler()
		handler.addMessages([{ ts: 1, type: "say", say: "text", text: "hello", partial: false }])
		const copy = handler.getClineMessages()
		copy.push({ ts: 2, type: "say", say: "text", text: "extra", partial: false })
		expect(handler.getClineMessages()).toHaveLength(1)
	})

	it("should clear messages", () => {
		const handler = new MessageStateHandler()
		handler.addMessages([{ ts: 1, type: "say", say: "text", text: "hello", partial: false }])
		handler.clear()
		expect(handler.getClineMessages()).toEqual([])
	})

	it("should accumulate messages across multiple addMessages calls", () => {
		const handler = new MessageStateHandler()
		handler.addMessages([{ ts: 1, type: "say", say: "text", text: "first", partial: false }])
		handler.addMessages([{ ts: 2, type: "say", say: "text", text: "second", partial: false }])
		expect(handler.getClineMessages()).toHaveLength(2)
	})
})

describe("createTaskProxy", () => {
	it("should expose sessionId as ulid and taskId", () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		expect(proxy.ulid).toBe("session-123")
		expect(proxy.taskId).toBe("session-123")
	})

	it("should delegate messageResponse to onAskResponse", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.handleWebviewAskResponse("messageResponse", "hello", ["img1"], ["file1"])

		expect(onAskResponse).toHaveBeenCalledWith("hello", ["img1"], ["file1"])
	})

	it("should delegate yesButtonClicked to onAskResponse", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.handleWebviewAskResponse("yesButtonClicked", "", [], [])

		expect(onAskResponse).toHaveBeenCalledWith("", [], [])
	})

	it("should delegate noButtonClicked to onAskResponse", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.handleWebviewAskResponse("noButtonClicked", "", [], [])

		expect(onAskResponse).toHaveBeenCalledWith("", [], [])
	})

	it("should delegate unknown askResponse types to onAskResponse", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		// biome-ignore lint/suspicious/noExplicitAny: testing unknown ask response type
		await proxy.handleWebviewAskResponse("command" as any, "ls -la", [], [])

		expect(onAskResponse).toHaveBeenCalledWith("ls -la", [], [])
	})

	it("should store askResponse in taskState", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.handleWebviewAskResponse("messageResponse", "hello")

		expect(proxy.taskState.askResponse).toBe("messageResponse")
	})

	it("should delegate abortTask to onCancelTask", async () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn().mockResolvedValue(undefined)
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.abortTask()

		expect(onCancelTask).toHaveBeenCalled()
	})

	it("should provide a stub API handler", () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		expect(proxy.api.getModel().id).toBe("unknown")
	})

	it("should return undefined for removed features", () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		expect(proxy.browserSession).toBeUndefined()
		expect(proxy.checkpointManager).toBeUndefined()
		expect(proxy.terminalManager).toBeUndefined()
	})

	it("should provide a messageStateHandler", () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		expect(proxy.messageStateHandler).toBeInstanceOf(MessageStateHandler)
		expect(proxy.messageStateHandler.getClineMessages()).toEqual([])
	})

	it("should accumulate messages in messageStateHandler", () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		proxy.messageStateHandler.addMessages([{ ts: 1, type: "say", say: "text", text: "hello", partial: false }])

		expect(proxy.messageStateHandler.getClineMessages()).toHaveLength(1)
	})
})
