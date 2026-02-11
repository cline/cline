import { Task } from "@core/task"
import { expect } from "chai"
import sinon from "sinon"

describe("Task.say", () => {
	it("skips duplicate partial text when the same completed text was just rendered", async () => {
		const addToClineMessages = sinon.stub().resolves()
		const updateClineMessage = sinon.stub().resolves()
		const postStateToWebview = sinon.stub().resolves()

		const fakeTask: any = {
			taskState: { abort: false, lastMessageTs: 0 },
			getCurrentProviderInfo: () => ({
				providerId: "minimax",
				model: { id: "MiniMax-M2.1" },
				mode: "act",
			}),
			messageStateHandler: {
				getClineMessages: () => [
					{
						type: "say",
						say: "text",
						text: "Hello! How can I help you today?",
						partial: false,
						ts: Date.now(),
					},
				],
				addToClineMessages,
				updateClineMessage,
			},
			postStateToWebview,
		}

		const result = await Task.prototype.say.call(
			fakeTask,
			"text",
			"Hello! How can I help you today?",
			undefined,
			undefined,
			true,
		)

		expect(result).to.equal(undefined)
		expect(addToClineMessages.called).to.equal(false)
		expect(updateClineMessage.called).to.equal(false)
		expect(postStateToWebview.called).to.equal(false)
	})

	it("still adds a partial text when content differs", async () => {
		const addToClineMessages = sinon.stub().resolves()
		const updateClineMessage = sinon.stub().resolves()
		const postStateToWebview = sinon.stub().resolves()

		const fakeTask: any = {
			taskState: { abort: false, lastMessageTs: 0 },
			getCurrentProviderInfo: () => ({
				providerId: "minimax",
				model: { id: "MiniMax-M2.1" },
				mode: "act",
			}),
			messageStateHandler: {
				getClineMessages: () => [
					{
						type: "say",
						say: "text",
						text: "Hello! How can I help you today?",
						partial: false,
						ts: Date.now(),
					},
				],
				addToClineMessages,
				updateClineMessage,
			},
			postStateToWebview,
		}

		await Task.prototype.say.call(
			fakeTask,
			"text",
			"Hello! How can I help you today? More details...",
			undefined,
			undefined,
			true,
		)

		expect(addToClineMessages.calledOnce).to.equal(true)
		expect(updateClineMessage.called).to.equal(false)
		expect(postStateToWebview.calledOnce).to.equal(true)
	})
})
