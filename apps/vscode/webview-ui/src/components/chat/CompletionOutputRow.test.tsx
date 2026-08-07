import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CompletionOutputRow } from "./CompletionOutputRow"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"

vi.mock("./MarkdownRow", () => ({
	MarkdownRow: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

vi.mock("@/components/common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

const hiddenQuoteButton = { visible: false, top: 0, left: 0, selectedText: "" }

describe("CompletionOutputRow", () => {
	const writeText = vi.fn(() => Promise.resolve())

	beforeEach(() => {
		writeText.mockClear()
		Object.assign(navigator, { clipboard: { writeText } })
	})

	it("shows a small Completed header with a copy button", () => {
		render(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)

		expect(screen.getByText("Completed")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Copy response" })).toBeInTheDocument()
	})

	it("copies the response text to the clipboard", async () => {
		render(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)

		fireEvent.click(screen.getByRole("button", { name: "Copy response" }))

		await waitFor(() => expect(writeText).toHaveBeenCalledWith("All done!"))
	})
})

describe("PlanCompletionOutputRow", () => {
	const writeText = vi.fn(() => Promise.resolve())

	beforeEach(() => {
		writeText.mockClear()
		Object.assign(navigator, { clipboard: { writeText } })
	})

	it("shows a small Plan header with a copy button", () => {
		render(<PlanCompletionOutputRow text="Here is the plan" />)

		expect(screen.getByText("Plan")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Copy plan response" })).toBeInTheDocument()
	})

	it("copies the plan response text to the clipboard", async () => {
		render(<PlanCompletionOutputRow text="Here is the plan" />)

		fireEvent.click(screen.getByRole("button", { name: "Copy plan response" }))

		await waitFor(() => expect(writeText).toHaveBeenCalledWith("Here is the plan"))
	})
})
