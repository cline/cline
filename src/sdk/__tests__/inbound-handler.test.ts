import { describe, it, expect, vi, beforeEach } from "vitest"
import { InboundMessageHandler, type InboundController } from "../inbound-handler"
import { WebviewBridge } from "../webview-bridge"
import type { WebviewOutbound } from "../../shared/WebviewMessages"

describe("InboundMessageHandler", () => {
	let controller: InboundController
	let bridge: WebviewBridge
	let handler: InboundMessageHandler
	let sentMessages: WebviewOutbound[]

	beforeEach(() => {
		sentMessages = []
		controller = {}
		bridge = new WebviewBridge((msg) => sentMessages.push(msg))
		handler = new InboundMessageHandler(controller, bridge)
	})

	describe("ready message", () => {
		it("calls pushStateToWebview on the controller", async () => {
			controller.pushStateToWebview = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({ type: "ready" })

			expect(handled).toBe(true)
			expect(controller.pushStateToWebview).toHaveBeenCalledOnce()
		})

		it("returns true even if controller has no pushStateToWebview", async () => {
			const handled = await handler.handle({ type: "ready" })
			expect(handled).toBe(true)
		})
	})

	describe("newTask message", () => {
		it("calls initTask with text and images", async () => {
			controller.initTask = vi.fn().mockResolvedValue("task-123")

			const handled = await handler.handle({
				type: "newTask",
				text: "Write a hello world",
				images: ["img1.png"],
			})

			expect(handled).toBe(true)
			expect(controller.initTask).toHaveBeenCalledWith("Write a hello world", ["img1.png"])
		})
	})

	describe("askResponse message", () => {
		it("calls askResponse with response and text", async () => {
			controller.askResponse = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "askResponse",
				response: "yesButtonClicked",
				text: "Proceed",
			})

			expect(handled).toBe(true)
			expect(controller.askResponse).toHaveBeenCalledWith("yesButtonClicked", "Proceed", undefined)
		})
	})

	describe("cancelTask message", () => {
		it("calls cancelTask", async () => {
			controller.cancelTask = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({ type: "cancelTask" })

			expect(handled).toBe(true)
			expect(controller.cancelTask).toHaveBeenCalledOnce()
		})
	})

	describe("clearTask message", () => {
		it("calls clearTask", async () => {
			controller.clearTask = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({ type: "clearTask" })

			expect(handled).toBe(true)
			expect(controller.clearTask).toHaveBeenCalledOnce()
		})
	})

	describe("showTask message", () => {
		it("calls showTask with the id", async () => {
			controller.showTask = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({ type: "showTask", id: "task-456" })

			expect(handled).toBe(true)
			expect(controller.showTask).toHaveBeenCalledWith("task-456")
		})
	})

	describe("deleteTasks message", () => {
		it("calls deleteTasks with ids", async () => {
			controller.deleteTasks = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "deleteTasks",
				ids: ["t1", "t2"],
			})

			expect(handled).toBe(true)
			expect(controller.deleteTasks).toHaveBeenCalledWith(["t1", "t2"], undefined)
		})

		it("passes all flag", async () => {
			controller.deleteTasks = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "deleteTasks",
				ids: [],
				all: true,
			})

			expect(handled).toBe(true)
			expect(controller.deleteTasks).toHaveBeenCalledWith([], true)
		})
	})

	describe("updateSettings message", () => {
		it("calls updateSettings with settings", async () => {
			controller.updateSettings = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "updateSettings",
				settings: { preferredLanguage: "English" },
			})

			expect(handled).toBe(true)
			expect(controller.updateSettings).toHaveBeenCalledWith({ preferredLanguage: "English" })
		})
	})

	describe("toggleMode message", () => {
		it("calls toggleMode with mode", async () => {
			controller.toggleMode = vi.fn().mockResolvedValue(true)

			const handled = await handler.handle({
				type: "toggleMode",
				mode: "plan",
			})

			expect(handled).toBe(true)
			expect(controller.toggleMode).toHaveBeenCalledWith("plan")
		})
	})

	describe("toggleFavoriteModel message", () => {
		it("calls toggleFavoriteModel with modelId", async () => {
			controller.toggleFavoriteModel = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "toggleFavoriteModel",
				modelId: "claude-4-sonnet",
			})

			expect(handled).toBe(true)
			expect(controller.toggleFavoriteModel).toHaveBeenCalledWith("claude-4-sonnet")
		})
	})

	describe("refreshModels message", () => {
		it("calls refreshModels with providerId", async () => {
			controller.refreshModels = vi.fn().mockResolvedValue(undefined)

			const handled = await handler.handle({
				type: "refreshModels",
				providerId: "openrouter",
			})

			expect(handled).toBe(true)
			expect(controller.refreshModels).toHaveBeenCalledWith("openrouter", undefined)
		})
	})

	describe("generic operations", () => {
		it("delegates fileOp to handleGenericOp", async () => {
			controller.handleGenericOp = vi.fn().mockResolvedValue({ success: true })

			const handled = await handler.handle({
				type: "fileOp",
				op: "open",
				requestId: "req-1",
				value: "/path/to/file",
			})

			expect(handled).toBe(true)
			expect(controller.handleGenericOp).toHaveBeenCalledWith("fileOp", "open", "req-1", { value: "/path/to/file" })
		})

		it("sends rpcResponse for generic ops with requestId", async () => {
			controller.handleGenericOp = vi.fn().mockResolvedValue({ items: [] })

			await handler.handle({
				type: "mcpOp",
				op: "getLatest",
				requestId: "req-2",
				params: {},
			})

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "rpcResponse",
				requestId: "req-2",
				method: "mcpOp.getLatest",
				data: { items: [] },
				error: undefined,
			})
		})
	})

	describe("error handling", () => {
		it("sends error response when handler throws", async () => {
			controller.initTask = vi.fn().mockRejectedValue(new Error("API key missing"))

			const handled = await handler.handle({
				type: "newTask",
				text: "test",
			} as any)

			// Still returns true (handled, but with error)
			expect(handled).toBe(true)
		})

		it("sends error rpcResponse when handler with requestId throws", async () => {
			controller.handleGenericOp = vi.fn().mockRejectedValue(new Error("Not found"))

			await handler.handle({
				type: "fileOp",
				op: "open",
				requestId: "req-err",
				value: "/bad/path",
			})

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "rpcResponse",
				requestId: "req-err",
				method: "fileOp",
				data: undefined,
				error: "Not found",
			})
		})
	})

	describe("unrecognized messages", () => {
		it("returns false for unknown message types", async () => {
			const handled = await handler.handle({ type: "unknownType" } as any)
			expect(handled).toBe(false)
		})
	})
})
