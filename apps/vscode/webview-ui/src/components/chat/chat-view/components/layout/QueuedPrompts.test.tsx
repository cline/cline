import type { QueuedPrompt } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueuedPrompts } from "./QueuedPrompts"

const cancelQueuedPromptMock = vi.hoisted(() => vi.fn())
const updateQueuedPromptMock = vi.hoisted(() => vi.fn())
const reorderQueuedPromptMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		cancelQueuedPrompt: (request: unknown) => cancelQueuedPromptMock(request),
		updateQueuedPrompt: (request: unknown) => updateQueuedPromptMock(request),
		reorderQueuedPrompt: (request: unknown) => reorderQueuedPromptMock(request),
	},
}))

vi.mock("@shared/proto/cline/common", () => ({
	StringRequest: {
		create: (request: unknown) => request,
	},
}))

vi.mock("@shared/proto/cline/task", () => ({
	UpdateQueuedPromptRequest: {
		create: (request: unknown) => request,
	},
	ReorderQueuedPromptRequest: {
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

function makeDataTransfer(): DataTransfer {
	return {
		effectAllowed: "",
		dropEffect: "move",
		setData: vi.fn(),
		getData: vi.fn(),
	} as unknown as DataTransfer
}

describe("QueuedPrompts", () => {
	beforeEach(() => {
		cancelQueuedPromptMock.mockReset()
		updateQueuedPromptMock.mockReset()
		reorderQueuedPromptMock.mockReset()
		cancelQueuedPromptMock.mockResolvedValue({})
		updateQueuedPromptMock.mockResolvedValue({})
		reorderQueuedPromptMock.mockResolvedValue({})
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

	it("edits a queued prompt and persists the change", async () => {
		render(<QueuedPrompts items={queuedPrompts} />)

		fireEvent.click(screen.getAllByRole("button", { name: "Edit queued message" })[0])
		const input = screen.getByDisplayValue("First queued message")
		fireEvent.change(input, { target: { value: "Edited first message" } })
		fireEvent.click(screen.getByRole("button", { name: "Save queued message" }))

		await waitFor(() =>
			expect(updateQueuedPromptMock).toHaveBeenCalledWith({
				promptId: "prompt-1",
				prompt: "Edited first message",
			}),
		)
	})

	it("reorders a queued prompt via drag and drop", async () => {
		render(<QueuedPrompts items={queuedPrompts} />)

		const rows = screen.getAllByTitle("Drag to reorder").map((handle) => handle.closest("div")!)
		fireEvent.dragStart(rows[0], { dataTransfer: makeDataTransfer() })
		fireEvent.drop(rows[1], { dataTransfer: makeDataTransfer() })

		await waitFor(() =>
			expect(reorderQueuedPromptMock).toHaveBeenCalledWith({
				promptId: "prompt-1",
				position: 1,
			}),
		)
	})

	it("does not render an empty queue", () => {
		const { container } = render(<QueuedPrompts items={[]} />)

		expect(container).toBeEmptyDOMElement()
	})
})
