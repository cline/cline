import type { ExtensionState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState } from "./message-translator"
import { WebviewGrpcBridge } from "./webview-grpc-bridge"

// Mock the gRPC streaming functions
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
