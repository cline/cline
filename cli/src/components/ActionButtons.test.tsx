import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { getButtonConfig } from "./ActionButtons"

describe("CLI getButtonConfig", () => {
	describe("api_req_failed state", () => {
		it("allows sending messages (sendingDisabled is false)", () => {
			const errorMessage: ClineMessage = {
				type: "ask",
				ask: "api_req_failed",
				text: "Insufficient funds",
				ts: Date.now(),
			}
			const config = getButtonConfig(errorMessage)
			expect(config.sendingDisabled).toBe(false)
			expect(config.enableButtons).toBe(true)
			expect(config.primaryText).toBe("Retry")
			expect(config.primaryAction).toBe("retry")
			expect(config.secondaryText).toBe("Start New Task")
			expect(config.secondaryAction).toBe("new_task")
		})

		it("returns error config even when message is partial (streaming error)", () => {
			const errorMessage: ClineMessage = {
				type: "ask",
				ask: "api_req_failed",
				partial: true,
				text: "Rate limit exceeded",
				ts: Date.now(),
			}
			const config = getButtonConfig(errorMessage)
			// Error states should NOT be treated as streaming/partial
			expect(config.sendingDisabled).toBe(false)
			expect(config.enableButtons).toBe(true)
			expect(config.primaryAction).toBe("retry")
		})

		it("does not return partial config for api_req_failed during streaming", () => {
			const errorMessage: ClineMessage = {
				type: "ask",
				ask: "api_req_failed",
				text: "Connection error",
				ts: Date.now(),
			}
			// isStreaming=true should not override error state
			const config = getButtonConfig(errorMessage, true)
			expect(config.sendingDisabled).toBe(false)
			expect(config.primaryAction).toBe("retry")
		})
	})

	describe("default config", () => {
		it("returns default config when no message is provided", () => {
			const config = getButtonConfig(undefined)
			expect(config.sendingDisabled).toBe(false)
			expect(config.enableButtons).toBe(false)
		})
	})

	describe("streaming states", () => {
		it("returns partial config for non-error streaming messages", () => {
			const streamingMessage: ClineMessage = {
				type: "say",
				say: "api_req_started",
				partial: true,
				ts: Date.now(),
			}
			const config = getButtonConfig(streamingMessage, true)
			expect(config.sendingDisabled).toBe(true)
			expect(config.secondaryAction).toBe("cancel")
		})
	})
})
