import { describe, expect, it, vi } from "vitest"
import type { Controller } from "../index"
import { sendContextMenuPrompt } from "./sendContextMenuPrompt"

describe("sendContextMenuPrompt", () => {
	it("continues the active task", async () => {
		const handleWebviewAskResponse = vi.fn().mockResolvedValue(undefined)
		const initTask = vi.fn()
		const controller = { task: { handleWebviewAskResponse }, initTask } as unknown as Controller

		await sendContextMenuPrompt(controller, "explain this")

		expect(handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "explain this")
		expect(initTask).not.toHaveBeenCalled()
	})

	it("starts a task when no task is active", async () => {
		const initTask = vi.fn().mockResolvedValue(undefined)
		const controller = { task: undefined, initTask } as unknown as Controller

		await sendContextMenuPrompt(controller, "explain this")

		expect(initTask).toHaveBeenCalledWith("explain this")
	})
})
