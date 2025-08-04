import * as assert from "assert"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitUntilCompleted } from "./utils"
import { setDefaultSuiteTimeout } from "./test-utils"

suite("Markdown List Rendering", function () {
	setDefaultSuiteTimeout(this)

	test("Should render unordered lists with bullets in chat", async () => {
		const api = globalThis.api

		const messages: ClineMessage[] = []

		api.on(RooCodeEventName.Message, ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const taskId = await api.startNewTask({
			configuration: { mode: "ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Please show me an example of an unordered list with the following items: Apple, Banana, Orange",
		})

		await waitUntilCompleted({ api, taskId })

		// Find the message containing the list
		const listMessage = messages.find(
			({ say, text }) =>
				(say === "completion_result" || say === "text") &&
				text?.includes("Apple") &&
				text?.includes("Banana") &&
				text?.includes("Orange"),
		)

		assert.ok(listMessage, "Should have a message containing the list items")

		// The rendered markdown should contain list markers
		const messageText = listMessage?.text || ""
		assert.ok(
			messageText.includes("- Apple") || messageText.includes("* Apple") || messageText.includes("• Apple"),
			"List items should be rendered with bullet points",
		)
	})

	test("Should render ordered lists with numbers in chat", async () => {
		const api = globalThis.api

		const messages: ClineMessage[] = []

		api.on(RooCodeEventName.Message, ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const taskId = await api.startNewTask({
			configuration: { mode: "ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Please show me a numbered list with three steps: First step, Second step, Third step",
		})

		await waitUntilCompleted({ api, taskId })

		// Find the message containing the numbered list
		const listMessage = messages.find(
			({ say, text }) =>
				(say === "completion_result" || say === "text") &&
				text?.includes("First step") &&
				text?.includes("Second step") &&
				text?.includes("Third step"),
		)

		assert.ok(listMessage, "Should have a message containing the numbered list")

		// The rendered markdown should contain numbered markers
		const messageText = listMessage?.text || ""
		assert.ok(
			messageText.includes("1. First step") || messageText.includes("1) First step"),
			"List items should be rendered with numbers",
		)
	})

	test("Should render nested lists with proper hierarchy", async () => {
		const api = globalThis.api

		const messages: ClineMessage[] = []

		api.on(RooCodeEventName.Message, ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const taskId = await api.startNewTask({
			configuration: { mode: "ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Please create a nested list with 'Main item' having two sub-items: 'Sub-item A' and 'Sub-item B'",
		})

		await waitUntilCompleted({ api, taskId })

		// Find the message containing the nested list
		const listMessage = messages.find(
			({ say, text }) =>
				(say === "completion_result" || say === "text") &&
				text?.includes("Main item") &&
				text?.includes("Sub-item A") &&
				text?.includes("Sub-item B"),
		)

		assert.ok(listMessage, "Should have a message containing the nested list")

		// The rendered markdown should show hierarchy through indentation
		const messageText = listMessage?.text || ""

		// Check for main item
		assert.ok(
			messageText.includes("- Main item") ||
				messageText.includes("* Main item") ||
				messageText.includes("• Main item"),
			"Main list item should be rendered",
		)

		// Check for sub-items with indentation (typically 2-4 spaces or a tab)
		assert.ok(
			messageText.match(/\s{2,}- Sub-item A/) ||
				messageText.match(/\s{2,}\* Sub-item A/) ||
				messageText.match(/\s{2,}• Sub-item A/) ||
				messageText.includes("\t- Sub-item A") ||
				messageText.includes("\t* Sub-item A") ||
				messageText.includes("\t• Sub-item A"),
			"Sub-items should be indented",
		)
	})

	test("Should render mixed ordered and unordered lists", async () => {
		const api = globalThis.api

		const messages: ClineMessage[] = []

		api.on(RooCodeEventName.Message, ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.partial === false) {
				messages.push(message)
			}
		})

		const taskId = await api.startNewTask({
			configuration: { mode: "ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Please create a list that has both numbered items and bullet points, mixing ordered and unordered lists",
		})

		await waitUntilCompleted({ api, taskId })

		// Find a message that contains both types of lists
		const listMessage = messages.find(
			({ say, text }) =>
				(say === "completion_result" || say === "text") &&
				text &&
				// Check for numbered list markers
				(text.includes("1.") || text.includes("1)")) &&
				// Check for bullet list markers
				(text.includes("-") || text.includes("*") || text.includes("•")),
		)

		assert.ok(listMessage, "Should have a message containing mixed list types")
	})
})
