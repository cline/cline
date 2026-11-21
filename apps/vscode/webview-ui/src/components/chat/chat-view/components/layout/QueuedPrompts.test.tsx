import type { QueuedPrompt } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueuedPrompts } from "./QueuedPrompts"

const cancelQueuedPromptMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		cancelQueuedPrompt: (request: unknown) => cancelQueuedPromptMock(request),
	},
}))

vi.mock("@shared/proto/cline/common", () => ({
	StringRequest: {
		create: (request: unknown) => request,
	},
}))

const queuedPrompts: QueuedPrompt[] = [
	{
		id: "prompt-1",
		prompt: "First queued message",
		delivery: "queue",
		attachmentCount: 0,
	},
	{
		id: "prompt-2",
		prompt: "Second queued message",
		delivery: "steer",
		attachmentCount: 1,
	},
]

describe("QueuedPrompts", () => {
	beforeEach(() => {
		cancelQueuedPromptMock.mockReset()
		cancelQueuedPromptMock.mockResolvedValue({})
	})

	it("cancels a queued prompt from the row action", async () => {
		render(<QueuedPrompts items={queuedPrompts} />)

		const cancelButtons = screen.getAllByRole("button", { name: "Cancel queued message" })
		fireEvent.click(cancelButtons[0])

		expect(cancelQueuedPromptMock).toHaveBeenCalledTimes(1)
		expect(cancelQueuedPromptMock).toHaveBeenCalledWith({ value: "prompt-1" })
		expect(cancelButtons[0]).toBeDisabled()

		await waitFor(() => expect(cancelButtons[0]).not.toBeDisabled())
	})

	it("does not render an empty queue", () => {
		const { container } = render(<QueuedPrompts items={[]} />)

		expect(container).toBeEmptyDOMElement()
	})

	it("reveals newly queued messages without scrolling on removals or unchanged updates", () => {
		const { rerender } = render(<QueuedPrompts items={queuedPrompts} />)
		const list = screen.getByText("First queued message").parentElement?.parentElement
		if (!list) throw new Error("Queue container was not rendered")
		Object.defineProperty(list, "scrollHeight", { configurable: true, value: 400 })
		const added = { ...queuedPrompts[0], id: "prompt-3", prompt: "Newest queued message" }

		rerender(<QueuedPrompts items={[...queuedPrompts, added]} />)
		expect(list.scrollTop).toBe(400)

		list.scrollTop = 20
		rerender(<QueuedPrompts items={[...queuedPrompts, { ...added }]} />)
		expect(list.scrollTop).toBe(20)
		rerender(<QueuedPrompts items={queuedPrompts} />)
		expect(list.scrollTop).toBe(20)

		// A delivery and an addition can arrive in the same state update.
		rerender(<QueuedPrompts items={[queuedPrompts[1], added]} />)
		expect(list.scrollTop).toBe(400)
	})
})
