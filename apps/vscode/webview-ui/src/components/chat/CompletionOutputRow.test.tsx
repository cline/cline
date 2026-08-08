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

const checkpointLatestChangesCount = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	CheckpointsServiceClient: {
		checkpointLatestChangesCount: (...args: unknown[]) => checkpointLatestChangesCount(...args),
		checkpointViewLatestChanges: vi.fn(() => Promise.resolve({})),
	},
}))

// Render VSCodeButton (used by SuccessButton) as a native button so it is
// observable through testing-library roles.
vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		VSCodeButton: ({
			children,
			disabled,
			onClick,
		}: {
			children?: React.ReactNode
			disabled?: boolean
			onClick?: () => void
		}) => (
			<button disabled={disabled} onClick={onClick} type="button">
				{children}
			</button>
		),
	}
})

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

describe("CompletionOutputRow View Changes", () => {
	beforeEach(() => {
		checkpointLatestChangesCount.mockReset()
	})

	const renderWithViewChanges = () =>
		render(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				showViewChanges
				text="All done!"
			/>,
		)

	it("shows the button once the host confirms the latest run changed files", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		renderWithViewChanges()

		const button = await screen.findByRole("button", { name: /View Changes/ })
		expect(button).not.toBeDisabled()
	})

	it("stays hidden while the count is still being checked", () => {
		checkpointLatestChangesCount.mockReturnValue(new Promise(() => {}))

		renderWithViewChanges()

		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("stays hidden when nothing changed since the last message", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 0 })

		renderWithViewChanges()

		await waitFor(() => expect(checkpointLatestChangesCount).toHaveBeenCalled())
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("stays hidden when the count request fails (e.g. no checkpoint to compare against)", async () => {
		checkpointLatestChangesCount.mockRejectedValue(new Error("boom"))

		renderWithViewChanges()

		await waitFor(() => expect(checkpointLatestChangesCount).toHaveBeenCalled())
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("never renders the button when showViewChanges is not set", () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		render(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)

		expect(checkpointLatestChangesCount).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
	})

	it("re-checks instead of reusing a stale positive answer when showViewChanges toggles", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ value: 2 })

		const { rerender } = renderWithViewChanges()
		await screen.findByRole("button", { name: /View Changes/ })

		rerender(<CompletionOutputRow handleQuoteClick={vi.fn()} quoteButtonState={hiddenQuoteButton} text="All done!" />)
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()

		// Second evaluation never resolves: the earlier `true` must not leak
		// through and flash the button while the host is still checking.
		checkpointLatestChangesCount.mockReturnValue(new Promise(() => {}))
		rerender(
			<CompletionOutputRow
				handleQuoteClick={vi.fn()}
				quoteButtonState={hiddenQuoteButton}
				showViewChanges
				text="All done!"
			/>,
		)
		expect(checkpointLatestChangesCount).toHaveBeenCalledTimes(2)
		expect(screen.queryByRole("button", { name: /View Changes/ })).toBeNull()
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
