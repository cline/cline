import type { ExtensionState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState } from "./message-translator"
import { pushMessageToWebview, WebviewGrpcBridge } from "./webview-grpc-bridge"

// Mock the gRPC streaming functions
vi.mock("@core/controller/ui/subscribeToPartialMessage", () => ({
	sendPartialMessageEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@core/controller/state/subscribeToState", () => ({
	sendStateUpdate: vi.fn().mockResolvedValue(undefined),
}))

// Mock the proto conversion
vi.mock("@shared/proto-conversions/cline-message", () => ({
	convertClineMessageToProto: vi.fn((msg: Record<string, unknown>) => ({
		ts: msg.ts,
		type: msg.type === "ask" ? 1 : 2,
		ask: 0,
		say: 0,
		text: (msg.text as string) ?? "",
		reasoning: (msg.reasoning as string) ?? "",
		images: [],
		files: [],
		partial: (msg.partial as boolean) ?? false,
	})),
}))

describe("WebviewGrpcBridge", () => {
	let bridge: WebviewGrpcBridge
	let translatorState: MessageTranslatorState

	beforeEach(() => {
		translatorState = new MessageTranslatorState()
		bridge = new WebviewGrpcBridge(translatorState)
		vi.clearAllMocks()
	})

	describe("createListener", () => {
		it("should return a function", () => {
			const listener = bridge.createListener()
			expect(typeof listener).toBe("function")
		})

		it("should push messages through the partial message stream", async () => {
			const { sendPartialMessageEvent } = await import("@core/controller/ui/subscribeToPartialMessage")
			const listener = bridge.createListener()

			const messages = [{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }]
			const event = { type: "status", payload: { sessionId: "s1", status: "running" } }

			// biome-ignore lint/suspicious/noExplicitAny: test-only event type
			listener(messages, event as any)

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(sendPartialMessageEvent).toHaveBeenCalledTimes(1)
		})

		it("should push multiple messages through the stream", async () => {
			const { sendPartialMessageEvent } = await import("@core/controller/ui/subscribeToPartialMessage")
			const listener = bridge.createListener()

			const messages = [
				{ ts: 1, type: "say" as const, say: "text" as const, text: "first", partial: false },
				{ ts: 2, type: "say" as const, say: "tool" as const, text: "tool call", partial: false },
			]
			const event = { type: "status", payload: { sessionId: "s1", status: "running" } }

			// biome-ignore lint/suspicious/noExplicitAny: test-only event type
			listener(messages, event as any)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(sendPartialMessageEvent).toHaveBeenCalledTimes(2)
		})
	})

	describe("pushStateUpdateFromController", () => {
		it("should push state from the provided getter", async () => {
			const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
			const mockState = { version: "1.0.0", mode: "act" } as unknown as ExtensionState

			await bridge.pushStateUpdateFromController(async () => mockState)

			expect(sendStateUpdate).toHaveBeenCalledWith(mockState)
		})

		it("should handle errors from the state getter", async () => {
			const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
			const errorGetter = async () => {
				throw new Error("state error")
			}

			await bridge.pushStateUpdateFromController(errorGetter)

			expect(sendStateUpdate).not.toHaveBeenCalled()
		})
	})
})

describe("pushMessageToWebview", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should push a single message to the webview", async () => {
		const { sendPartialMessageEvent } = await import("@core/controller/ui/subscribeToPartialMessage")

		const message = { ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }

		await pushMessageToWebview(message)

		expect(sendPartialMessageEvent).toHaveBeenCalledTimes(1)
	})

	it("should handle errors gracefully", async () => {
		const { sendPartialMessageEvent } = await import("@core/controller/ui/subscribeToPartialMessage")
		// biome-ignore lint/suspicious/noExplicitAny: mock method not in type
		;(sendPartialMessageEvent as any).mockRejectedValueOnce(new Error("stream error"))

		const message = { ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false }

		// Should not throw
		await pushMessageToWebview(message)
	})
})
