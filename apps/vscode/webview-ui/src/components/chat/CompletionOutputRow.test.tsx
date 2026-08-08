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

// Render VSCodeButton (used by SuccessButton) as a native button so
// `disabled` and `title` are observable in the DOM.
vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		VSCodeButton: ({
			children,
			disabled,
			onClick,
			title,
		}: {
			children?: React.ReactNode
			disabled?: boolean
			onClick?: () => void
			title?: string
		}) => (
			<button disabled={disabled} onClick={onClick} title={title} type="button">
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

	it("enables the button without a tooltip when the latest checkpoint has changes", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ count: 2, hasCheckpoint: true })

		renderWithViewChanges()

		const button = screen.getByRole("button", { name: /View Changes/ })
		await waitFor(() => expect(button).not.toBeDisabled())
		expect(button).not.toHaveAttribute("title")
	})

	it("explains 'no file changes' when a checkpoint exists but nothing changed", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ count: 0, hasCheckpoint: true })

		renderWithViewChanges()

		const button = screen.getByRole("button", { name: /View Changes/ })
		await waitFor(() => expect(button).toHaveAttribute("title", "No file changes since your last message"))
		expect(button).toBeDisabled()
	})

	it("explains that checkpoints are unavailable when there is no checkpoint to compare against", async () => {
		checkpointLatestChangesCount.mockResolvedValue({ count: 0, hasCheckpoint: false })

		renderWithViewChanges()

		const button = screen.getByRole("button", { name: /View Changes/ })
		await waitFor(() =>
			expect(button).toHaveAttribute(
				"title",
				"Checkpoints aren't available for this task (the workspace isn't a git repository with at least one commit)",
			),
		)
		expect(button).toBeDisabled()
	})

	it("treats a failed count request as checkpoints unavailable", async () => {
		checkpointLatestChangesCount.mockRejectedValue(new Error("boom"))

		renderWithViewChanges()

		const button = screen.getByRole("button", { name: /View Changes/ })
		await waitFor(() =>
			expect(button).toHaveAttribute(
				"title",
				"Checkpoints aren't available for this task (the workspace isn't a git repository with at least one commit)",
			),
		)
		expect(button).toBeDisabled()
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
