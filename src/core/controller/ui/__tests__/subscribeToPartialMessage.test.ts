import { afterEach, describe, it } from "mocha"
import "should"
import { ClineMessage, ClineMessageType, ClineSay } from "@shared/proto/cline/ui"
import {
	registerPartialMessageCallback,
	resetPartialMessageThrottle,
	sendPartialMessageEvent,
} from "../subscribeToPartialMessage"

/**
 * Helper to wait for a specific duration (real timers)
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("subscribeToPartialMessage", () => {
	afterEach(() => {
		// Clean up throttle state after each test
		resetPartialMessageThrottle()
	})

	describe("throttle timing for text messages", () => {
		it("should send first partial message immediately", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			const message = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "Hello",
				partial: true,
			})

			await sendPartialMessageEvent(message)

			// Should send immediately (no throttle on first message)
			receivedMessages.should.have.length(1)
			receivedMessages[0].text.should.equal("Hello")

			unsubscribe()
		})

		it("should throttle second partial text message to 50ms", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			const message1 = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "Hello",
				partial: true,
			})

			const message2 = ClineMessage.create({
				ts: 1010,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "Hello World",
				partial: true,
			})

			// Send first message
			await sendPartialMessageEvent(message1)
			receivedMessages.should.have.length(1)

			// Send second message immediately (within 50ms)
			await sendPartialMessageEvent(message2)

			// Second message should be throttled (not sent yet)
			receivedMessages.should.have.length(1)

			// Wait for throttle delay (50ms) + buffer
			await delay(60)

			// Now the throttled message should be sent
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Hello World")

			unsubscribe()
		})

		it("should use trailing-edge behavior (latest value wins)", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send first message (goes through immediately)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "First",
					partial: true,
				}),
			)

			// Send rapid updates (all within throttle window)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Second",
					partial: true,
				}),
			)

			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1020,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Third",
					partial: true,
				}),
			)

			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1030,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Fourth (latest)",
					partial: true,
				}),
			)

			// Only first message sent so far
			receivedMessages.should.have.length(1)

			// Wait for throttle to complete
			await delay(60)

			// Should have sent the LATEST message ("Fourth"), not all of them
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Fourth (latest)")

			unsubscribe()
		})
	})

	describe("throttle timing for reasoning messages", () => {
		it("should throttle reasoning messages to 80ms", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			const message1 = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.REASONING,
				text: "Thinking step 1",
				partial: true,
			})

			const message2 = ClineMessage.create({
				ts: 1010,
				type: ClineMessageType.SAY,
				say: ClineSay.REASONING,
				text: "Thinking step 2",
				partial: true,
			})

			// Send first message
			await sendPartialMessageEvent(message1)
			receivedMessages.should.have.length(1)

			// Send second message immediately
			await sendPartialMessageEvent(message2)

			// Second message should be throttled
			receivedMessages.should.have.length(1)

			// Wait for reasoning throttle delay (80ms) + buffer
			await delay(90)

			// Now it should be sent
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Thinking step 2")

			unsubscribe()
		})
	})

	describe("complete message bypass", () => {
		it("should bypass throttle for complete messages", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send partial message
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial",
					partial: true,
				}),
			)

			// Send another partial immediately (will be throttled)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial 2",
					partial: true,
				}),
			)

			// Only first message sent
			receivedMessages.should.have.length(1)

			// Send complete message (should bypass throttle)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1020,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Complete",
					partial: false,
				}),
			)

			// Complete message should go through immediately
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Complete")
			receivedMessages[1].partial.should.be.false()

			unsubscribe()
		})

		it("should cancel pending throttled message when complete message arrives", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send first partial
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial 1",
					partial: true,
				}),
			)

			// Send second partial (throttled)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial 2 (should be cancelled)",
					partial: true,
				}),
			)

			receivedMessages.should.have.length(1)

			// Send complete message before throttle fires
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1020,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Complete",
					partial: false,
				}),
			)

			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Complete")

			// Wait to verify cancelled message doesn't arrive
			await delay(70)

			// Should NOT have sent the cancelled partial message
			receivedMessages.should.have.length(2)

			unsubscribe()
		})
	})

	describe("state isolation after reset", () => {
		it("should not delay new messages after reset", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send reasoning message (80ms throttle)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.REASONING,
					text: "Old task thinking",
					partial: true,
				}),
			)

			// Send another partial (will be throttled)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.REASONING,
					text: "Old task thinking 2",
					partial: true,
				}),
			)

			receivedMessages.should.have.length(1)

			// RESET (simulates task abort)
			resetPartialMessageThrottle()

			// Wait to verify old timer doesn't fire
			await delay(100)

			// Should NOT have sent the old throttled message
			receivedMessages.should.have.length(1)

			// Send new task message - should go through immediately
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 2000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "New task text",
					partial: true,
				}),
			)

			// Should send immediately (no delay from old task's throttle state)
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("New task text")

			unsubscribe()
		})

		it("should clear pending message on reset", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send messages to set up pending state
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "First",
					partial: true,
				}),
			)

			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Pending (should be cleared)",
					partial: true,
				}),
			)

			receivedMessages.should.have.length(1)

			// Reset before throttle fires
			resetPartialMessageThrottle()

			// Wait to verify pending doesn't fire
			await delay(70)

			// Pending message should NOT be sent
			receivedMessages.should.have.length(1)

			unsubscribe()
		})

		it("should reset lastPartialSendTime to 0", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send message to set lastPartialSendTime
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "First",
					partial: true,
				}),
			)

			// Wait significantly
			await delay(200)

			// Reset
			resetPartialMessageThrottle()

			// Send new message - should NOT be delayed by old lastPartialSendTime
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 2000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "After reset",
					partial: true,
				}),
			)

			// Should send immediately
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("After reset")

			unsubscribe()
		})
	})

	describe("multiple subscribers", () => {
		it("should send to all registered callbacks", async () => {
			const received1: ClineMessage[] = []
			const received2: ClineMessage[] = []

			const unsub1 = registerPartialMessageCallback((msg) => received1.push(msg))
			const unsub2 = registerPartialMessageCallback((msg) => received2.push(msg))

			const message = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "Broadcast",
				partial: false,
			})

			await sendPartialMessageEvent(message)

			received1.should.have.length(1)
			received2.should.have.length(1)
			received1[0].text.should.equal("Broadcast")
			received2[0].text.should.equal("Broadcast")

			unsub1()
			unsub2()
		})

		it("should not send to unsubscribed callbacks", async () => {
			const received1: ClineMessage[] = []
			const received2: ClineMessage[] = []

			const unsub1 = registerPartialMessageCallback((msg) => received1.push(msg))
			const unsub2 = registerPartialMessageCallback((msg) => received2.push(msg))

			// Unsubscribe first callback
			unsub1()

			const message = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "Test",
				partial: false,
			})

			await sendPartialMessageEvent(message)

			// Only second callback should receive
			received1.should.have.length(0)
			received2.should.have.length(1)

			unsub2()
		})
	})

	describe("timer management", () => {
		it("should reuse timer for multiple rapid updates", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send first message
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "First",
					partial: true,
				}),
			)

			// Send multiple rapid updates (all should share same timer)
			for (let i = 1; i <= 5; i++) {
				await sendPartialMessageEvent(
					ClineMessage.create({
						ts: 1000 + i * 5,
						type: ClineMessageType.SAY,
						say: ClineSay.TEXT,
						text: `Update ${i}`,
						partial: true,
					}),
				)
			}

			// Only first message sent
			receivedMessages.should.have.length(1)

			// Wait for throttle
			await delay(60)

			// Should send latest update only
			receivedMessages.should.have.length(2)
			receivedMessages[1].text.should.equal("Update 5")

			unsubscribe()
		})

		it("should clear timer after sending throttled message", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Set up throttled message
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "First",
					partial: true,
				}),
			)

			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1010,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Second",
					partial: true,
				}),
			)

			// Wait for throttle
			await delay(60)

			receivedMessages.should.have.length(2)

			// Wait significantly longer
			await delay(150)

			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1220,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Third",
					partial: true,
				}),
			)

			// Should send immediately (enough time passed)
			receivedMessages.should.have.length(3)
			receivedMessages[2].text.should.equal("Third")

			unsubscribe()
		})
	})

	describe("edge cases", () => {
		it("should handle rapid complete messages correctly", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Send multiple complete messages rapidly
			for (let i = 1; i <= 5; i++) {
				await sendPartialMessageEvent(
					ClineMessage.create({
						ts: 1000 + i,
						type: ClineMessageType.SAY,
						say: ClineSay.TEXT,
						text: `Message ${i}`,
						partial: false,
					}),
				)
			}

			// All complete messages should go through immediately
			receivedMessages.should.have.length(5)

			unsubscribe()
		})

		it("should handle alternating partial and complete messages", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			// Partial
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1000,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial 1",
					partial: true,
				}),
			)

			// Wait long enough to reset throttle
			await delay(60)

			// Complete
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1070,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Complete 1",
					partial: false,
				}),
			)

			// Partial (after enough time has passed)
			await sendPartialMessageEvent(
				ClineMessage.create({
					ts: 1080,
					type: ClineMessageType.SAY,
					say: ClineSay.TEXT,
					text: "Partial 2",
					partial: true,
				}),
			)

			// All should be sent (complete bypasses, partials are far enough apart)
			receivedMessages.should.have.length(3)

			unsubscribe()
		})

		it("should handle messages with undefined partial (treated as complete)", async () => {
			const receivedMessages: ClineMessage[] = []
			const unsubscribe = registerPartialMessageCallback((msg) => {
				receivedMessages.push(msg)
			})

			const message = ClineMessage.create({
				ts: 1000,
				type: ClineMessageType.SAY,
				say: ClineSay.TEXT,
				text: "No partial field",
				// partial defaults to false
			})

			await sendPartialMessageEvent(message)

			// Should send immediately (undefined/false partial = complete)
			receivedMessages.should.have.length(1)

			unsubscribe()
		})
	})
})
