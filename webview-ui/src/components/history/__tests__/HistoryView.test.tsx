// cd webview-ui && npx jest src/components/history/__tests__/HistoryView.test.ts

import { render, screen, fireEvent, within, act } from "@testing-library/react"
import HistoryView from "../HistoryView"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"

jest.mock("../../../context/ExtensionStateContext")
jest.mock("../../../utils/vscode")
jest.mock("../../../i18n/TranslationContext")
jest.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: any) => (
		<div data-testid="virtuoso-container">
			{data.map((item: any, index: number) => (
				<div key={item.id} data-testid={`virtuoso-item-${item.id}`}>
					{itemContent(index, item)}
				</div>
			))}
		</div>
	),
}))

const mockTaskHistory = [
	{
		id: "1",
		number: 0,
		task: "Test task 1",
		ts: new Date("2022-02-16T00:00:00").getTime(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
	},
	{
		id: "2",
		number: 0,
		task: "Test task 2",
		ts: new Date("2022-02-17T00:00:00").getTime(),
		tokensIn: 200,
		tokensOut: 100,
		cacheWrites: 50,
		cacheReads: 25,
	},
]

describe("HistoryView", () => {
	beforeAll(() => {
		jest.useFakeTimers()
	})

	afterAll(() => {
		jest.useRealTimers()
	})

	beforeEach(() => {
		jest.clearAllMocks()
		;(useExtensionState as jest.Mock).mockReturnValue({
			taskHistory: mockTaskHistory,
		})
	})

	it("renders history items correctly", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Check if both tasks are rendered
		expect(screen.getByTestId("virtuoso-item-1")).toBeInTheDocument()
		expect(screen.getByTestId("virtuoso-item-2")).toBeInTheDocument()
		expect(screen.getByText("Test task 1")).toBeInTheDocument()
		expect(screen.getByText("Test task 2")).toBeInTheDocument()
	})

	it("handles search functionality", () => {
		// Setup clipboard mock that resolves immediately
		const mockClipboard = {
			writeText: jest.fn().mockResolvedValue(undefined),
		}
		Object.assign(navigator, { clipboard: mockClipboard })

		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Get search input and radio group
		const searchInput = screen.getByTestId("history-search-input")
		const radioGroup = screen.getByRole("radiogroup")

		// Type in search
		fireEvent.input(searchInput, { target: { value: "task 1" } })

		// Advance timers to process search state update
		jest.advanceTimersByTime(100)

		// Check if sort option automatically changes to "Most Relevant"
		const mostRelevantRadio = within(radioGroup).getByTestId("radio-most-relevant")
		expect(mostRelevantRadio).not.toBeDisabled()

		// Click the radio button
		fireEvent.click(mostRelevantRadio)

		// Advance timers to process radio button state update
		jest.advanceTimersByTime(100)

		// Verify radio button is checked
		const updatedRadio = within(radioGroup).getByTestId("radio-most-relevant")
		expect(updatedRadio).toBeInTheDocument()

		// Verify copy the plain text content of the task when the copy button is clicked
		const taskContainer = screen.getByTestId("virtuoso-item-1")
		fireEvent.mouseEnter(taskContainer)
		const copyButton = within(taskContainer).getByTestId("copy-prompt-button")
		fireEvent.click(copyButton)
		const taskContent = within(taskContainer).getByTestId("task-content")
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(taskContent.textContent)
	})

	it("handles sort options correctly", async () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		const radioGroup = screen.getByRole("radiogroup")

		// Test changing sort options
		const oldestRadio = within(radioGroup).getByTestId("radio-oldest")
		fireEvent.click(oldestRadio)

		// Wait for oldest radio to be checked
		const checkedOldestRadio = within(radioGroup).getByTestId("radio-oldest")
		expect(checkedOldestRadio).toBeInTheDocument()

		const mostExpensiveRadio = within(radioGroup).getByTestId("radio-most-expensive")
		fireEvent.click(mostExpensiveRadio)

		// Wait for most expensive radio to be checked
		const checkedExpensiveRadio = within(radioGroup).getByTestId("radio-most-expensive")
		expect(checkedExpensiveRadio).toBeInTheDocument()
	})

	it("handles task selection", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Click on first task
		fireEvent.click(screen.getByText("Test task 1"))

		// Verify vscode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "showTaskWithId",
			text: "1",
		})
	})

	describe("task deletion", () => {
		it("shows confirmation dialog on regular click", () => {
			const onDone = jest.fn()
			render(<HistoryView onDone={onDone} />)

			// Find and hover over first task
			const taskContainer = screen.getByTestId("virtuoso-item-1")
			fireEvent.mouseEnter(taskContainer)

			// Click delete button to open confirmation dialog
			const deleteButton = within(taskContainer).getByTestId("delete-task-button")
			fireEvent.click(deleteButton)

			// Verify dialog is shown
			const dialog = screen.getByRole("alertdialog")
			expect(dialog).toBeInTheDocument()

			// Find and click the confirm delete button in the dialog
			const confirmDeleteButton = within(dialog).getByRole("button", { name: /delete/i })
			fireEvent.click(confirmDeleteButton)

			// Verify vscode message was sent
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "deleteTaskWithId",
				text: "1",
			})
		})

		it("deletes immediately on shift-click without confirmation", () => {
			const onDone = jest.fn()
			render(<HistoryView onDone={onDone} />)

			// Find and hover over first task
			const taskContainer = screen.getByTestId("virtuoso-item-1")
			fireEvent.mouseEnter(taskContainer)

			// Shift-click delete button
			const deleteButton = within(taskContainer).getByTestId("delete-task-button")
			fireEvent.click(deleteButton, { shiftKey: true })

			// Verify no dialog is shown
			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

			// Verify vscode message was sent
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "deleteTaskWithId",
				text: "1",
			})
		})
	})

	it("handles task copying", async () => {
		// Setup clipboard mock that resolves immediately
		const mockClipboard = {
			writeText: jest.fn().mockResolvedValue(undefined),
		}
		Object.assign(navigator, { clipboard: mockClipboard })

		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Find and hover over first task
		const taskContainer = screen.getByTestId("virtuoso-item-1")
		fireEvent.mouseEnter(taskContainer)

		const copyButton = within(taskContainer).getByTestId("copy-prompt-button")

		// Click the copy button and wait for clipboard operation
		await act(async () => {
			fireEvent.click(copyButton)
			// Let the clipboard Promise resolve
			await Promise.resolve()
			// Let React process the first state update
			await Promise.resolve()
		})

		// Verify clipboard was called
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Test task 1")

		// Advance timer to trigger the setTimeout for modal disappearance
		act(() => {
			jest.advanceTimersByTime(2000)
		})

		// Verify modal is gone
		expect(screen.queryByText("Prompt Copied to Clipboard")).not.toBeInTheDocument()
	})

	it("formats dates correctly", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Find first task container and check date format
		const taskContainer = screen.getByTestId("virtuoso-item-1")
		const dateElement = within(taskContainer).getByText((content) => {
			return content.includes("FEBRUARY 16") && content.includes("12:00 AM")
		})
		expect(dateElement).toBeInTheDocument()
	})

	it("displays token counts correctly", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Find first task container
		const taskContainer = screen.getByTestId("virtuoso-item-1")

		// Find token counts within the task container
		const tokensContainer = within(taskContainer).getByTestId("tokens-container")
		expect(within(tokensContainer).getByTestId("tokens-in")).toHaveTextContent("100")
		expect(within(tokensContainer).getByTestId("tokens-out")).toHaveTextContent("50")
	})

	it("displays cache information when available", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Find second task container
		const taskContainer = screen.getByTestId("virtuoso-item-2")

		// Find cache info within the task container
		const cacheContainer = within(taskContainer).getByTestId("cache-container")
		expect(within(cacheContainer).getByTestId("cache-writes")).toHaveTextContent("+50")
		expect(within(cacheContainer).getByTestId("cache-reads")).toHaveTextContent("25")
	})

	it("handles export functionality", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Find and hover over second task
		const taskContainer = screen.getByTestId("virtuoso-item-2")
		fireEvent.mouseEnter(taskContainer)

		const exportButton = within(taskContainer).getByTestId("export")
		fireEvent.click(exportButton)

		// Verify vscode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "exportTaskWithId",
			text: "2",
		})
	})
})
