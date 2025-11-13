import { expect } from "chai"
import { describe, it } from "mocha"
import { createMockTask } from "./test-utils"

describe("Task.say() message timestamp", () => {
	it("should return timestamp when completing a partial message", async () => {
		// Setup task with minimal config
		const task = createMockTask()

		// Mock the message state to track partial messages
		const messages: any[] = []
		task.messageStateHandler.getClineMessages = () => messages
		task.messageStateHandler.addToClineMessages = async (msg: any) => {
			messages.push(msg)
		}

		// Send partial message
		const partialTs = await task.say("text", "Hello", undefined, undefined, true)
		expect(partialTs).to.be.greaterThan(0)

		// Complete the partial message - CRITICAL: should return timestamp
		const completeTs = await task.say("text", "Hello World", undefined, undefined, false)
		expect(completeTs).to.not.be.undefined
		expect(completeTs).to.equal(partialTs) // Should be same timestamp
	})

	it("should return timestamp for new non-partial messages", async () => {
		const task = createMockTask()

		// Mock the message state
		const messages: any[] = []
		task.messageStateHandler.getClineMessages = () => messages
		task.messageStateHandler.addToClineMessages = async (msg: any) => {
			messages.push(msg)
		}

		const ts = await task.say("text", "Hello")
		expect(ts).to.be.greaterThan(0)
	})

	it("should return undefined when updating existing partial message", async () => {
		const task = createMockTask()

		// Setup message state with an existing partial message
		const existingMessage = {
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Hello",
			partial: true,
		}
		const messages: any[] = [existingMessage]
		task.messageStateHandler.getClineMessages = () => messages

		// Update the partial message - should return undefined
		const ts = await task.say("text", "Hello World", undefined, undefined, true)
		expect(ts).to.be.undefined
	})

	it("should return new timestamp for new partial message", async () => {
		const task = createMockTask()

		// Setup empty message state
		const messages: any[] = []
		task.messageStateHandler.getClineMessages = () => messages
		task.messageStateHandler.addToClineMessages = async (msg: any) => {
			messages.push(msg)
		}

		// Create new partial message - should return timestamp
		const ts = await task.say("text", "Hello", undefined, undefined, true)
		expect(ts).to.be.greaterThan(0)
	})
})
