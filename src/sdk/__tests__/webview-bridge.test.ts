import { describe, it, expect, vi } from "vitest"
import { WebviewBridge } from "../webview-bridge"
import type { WebviewOutbound } from "../../shared/WebviewMessages"

describe("WebviewBridge", () => {
	function createBridge() {
		const messages: WebviewOutbound[] = []
		const postMessage = vi.fn((msg: WebviewOutbound) => {
			messages.push(msg)
		})
		const bridge = new WebviewBridge(postMessage)
		return { bridge, postMessage, messages }
	}

	describe("pushState", () => {
		it("sends a state message with the provided ExtensionState", () => {
			const { bridge, messages } = createBridge()
			const mockState = { version: "1.0.0", clineMessages: [] } as any

			bridge.pushState(mockState)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "state",
				state: mockState,
			})
		})
	})

	describe("pushPartialMessage", () => {
		it("sends a partialMessage with the provided ClineMessage", () => {
			const { bridge, messages } = createBridge()
			const mockMessage = { ts: 12345, type: "say", say: "text", text: "hello" } as any

			bridge.pushPartialMessage(mockMessage)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "partialMessage",
				message: mockMessage,
			})
		})
	})

	describe("navigate", () => {
		it("sends a navigate message for a basic view", () => {
			const { bridge, messages } = createBridge()

			bridge.navigate("settings")

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "navigate",
				view: "settings",
				tab: undefined,
				targetSection: undefined,
			})
		})

		it("sends a navigate message with options", () => {
			const { bridge, messages } = createBridge()

			bridge.navigate("settings", { targetSection: "browser" })

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "navigate",
				view: "settings",
				tab: undefined,
				targetSection: "browser",
			})
		})

		it("sends a navigate message with MCP tab", () => {
			const { bridge, messages } = createBridge()

			bridge.navigate("mcp", { tab: "marketplace" as any })

			expect(messages).toHaveLength(1)
			expect(messages[0]).toMatchObject({
				type: "navigate",
				view: "mcp",
				tab: "marketplace",
			})
		})
	})

	describe("pushMcpServers", () => {
		it("sends mcpServers message", () => {
			const { bridge, messages } = createBridge()
			const servers = [{ name: "test-server", config: {} }] as any

			bridge.pushMcpServers(servers)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "mcpServers",
				servers,
			})
		})
	})

	describe("pushMcpMarketplace", () => {
		it("sends mcpMarketplace message", () => {
			const { bridge, messages } = createBridge()
			const catalog = { items: [{ mcpId: "test" }] } as any

			bridge.pushMcpMarketplace(catalog)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "mcpMarketplace",
				catalog,
			})
		})
	})

	describe("pushModels", () => {
		it("sends models message with providerId", () => {
			const { bridge, messages } = createBridge()
			const models = { "model-1": { maxTokens: 4096 } } as any

			bridge.pushModels("openrouter", models)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "models",
				providerId: "openrouter",
				models,
			})
		})
	})

	describe("pushRelinquishControl", () => {
		it("sends relinquishControl message", () => {
			const { bridge, messages } = createBridge()

			bridge.pushRelinquishControl()

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({ type: "relinquishControl" })
		})
	})

	describe("pushAddToInput", () => {
		it("sends addToInput message with text", () => {
			const { bridge, messages } = createBridge()

			bridge.pushAddToInput("hello world")

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "addToInput",
				text: "hello world",
			})
		})
	})

	describe("pushShowWebview", () => {
		it("sends showWebview message", () => {
			const { bridge, messages } = createBridge()

			bridge.pushShowWebview("chat")

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "showWebview",
				view: "chat",
			})
		})
	})

	describe("pushTerminalProfiles", () => {
		it("sends terminalProfiles message", () => {
			const { bridge, messages } = createBridge()
			const profiles = [{ name: "bash" }, { name: "zsh" }]

			bridge.pushTerminalProfiles(profiles)

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "terminalProfiles",
				profiles,
			})
		})
	})

	describe("sendRpcResponse", () => {
		it("sends rpcResponse with data", () => {
			const { bridge, messages } = createBridge()

			bridge.sendRpcResponse("req-1", "getTaskHistory", { items: [] })

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "rpcResponse",
				requestId: "req-1",
				method: "getTaskHistory",
				data: { items: [] },
				error: undefined,
			})
		})

		it("sends rpcResponse with error", () => {
			const { bridge, messages } = createBridge()

			bridge.sendRpcResponse("req-2", "newTask", undefined, "Task failed")

			expect(messages).toHaveLength(1)
			expect(messages[0]).toEqual({
				type: "rpcResponse",
				requestId: "req-2",
				method: "newTask",
				data: undefined,
				error: "Task failed",
			})
		})
	})

	describe("setPostMessage", () => {
		it("updates the postMessage function", () => {
			const { bridge } = createBridge()
			const newMessages: WebviewOutbound[] = []
			const newPostMessage = vi.fn((msg: WebviewOutbound) => newMessages.push(msg))

			bridge.setPostMessage(newPostMessage)
			bridge.pushRelinquishControl()

			expect(newMessages).toHaveLength(1)
			expect(newMessages[0]).toEqual({ type: "relinquishControl" })
		})
	})
})
