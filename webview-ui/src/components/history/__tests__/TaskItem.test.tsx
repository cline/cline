import { render, screen, fireEvent } from "@testing-library/react"
import type { HistoryItem } from "@roo-code/types"
import TaskItem from "../TaskItem"
import { vscode } from "@src/utils/vscode"

jest.mock("@src/utils/vscode")
jest.mock("@src/i18n/TranslationContext")
jest.mock("lucide-react", () => ({
	DollarSign: () => <span data-testid="dollar-sign">$</span>,
	Coins: () => <span data-testid="coins-icon" />, // Mock for Coins icon used in TaskItemFooter compact
}))
jest.mock("../CopyButton", () => ({
	CopyButton: jest.fn(() => <button data-testid="mock-copy-button">Copy</button>),
}))
jest.mock("../ExportButton", () => ({
	ExportButton: jest.fn(() => <button data-testid="mock-export-button">Export</button>),
}))

const mockTask: HistoryItem = {
	number: 1,
	id: "test-task-1",
	task: "Test task content",
	ts: new Date("2022-02-16T00:00:00").getTime(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "test-workspace",
}

describe("TaskItem", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders compact variant correctly", () => {
		render(<TaskItem item={mockTask} variant="compact" />)

		expect(screen.getByText("Test task content")).toBeInTheDocument()
		// Check for tokens display
		expect(screen.getByTestId("tokens-in-footer-compact")).toHaveTextContent("100")
		expect(screen.getByTestId("tokens-out-footer-compact")).toHaveTextContent("50")
		expect(screen.getByTestId("cost-footer-compact")).toHaveTextContent("$0.00") // Cost
	})

	it("renders full variant correctly", () => {
		render(<TaskItem item={mockTask} variant="full" />)

		expect(screen.getByTestId("task-item-test-task-1")).toBeInTheDocument()
		expect(screen.getByTestId("task-content")).toBeInTheDocument()
		expect(screen.getByTestId("tokens-in-footer-full")).toHaveTextContent("100")
		expect(screen.getByTestId("tokens-out-footer-full")).toHaveTextContent("50")
	})

	it("shows workspace when showWorkspace is true", () => {
		render(<TaskItem item={mockTask} variant="compact" showWorkspace={true} />)

		expect(screen.getByText("test-workspace")).toBeInTheDocument()
	})

	it("handles click events correctly", () => {
		render(<TaskItem item={mockTask} variant="compact" />)

		fireEvent.click(screen.getByText("Test task content"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "showTaskWithId",
			text: "test-task-1",
		})
	})

	it("handles selection mode correctly", () => {
		const mockToggleSelection = jest.fn()
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelectionMode={true}
				isSelected={false}
				onToggleSelection={mockToggleSelection}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeInTheDocument()
		expect(checkbox).not.toBeChecked()

		fireEvent.click(screen.getByTestId("task-item-test-task-1"))

		expect(mockToggleSelection).toHaveBeenCalledWith("test-task-1", true)
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("shows delete button in full variant when not in selection mode", () => {
		const mockOnDelete = jest.fn()
		render(<TaskItem item={mockTask} variant="full" onDelete={mockOnDelete} />)

		const deleteButton = screen.getByTestId("delete-task-button")
		expect(deleteButton).toBeInTheDocument()

		fireEvent.click(deleteButton)

		expect(mockOnDelete).toHaveBeenCalledWith("test-task-1")
	})

	it("displays cache information when available", () => {
		const taskWithCache: HistoryItem = {
			...mockTask,
			cacheWrites: 25,
			cacheReads: 10,
		}

		render(<TaskItem item={taskWithCache} variant="full" />)

		expect(screen.getByTestId("cache-writes")).toHaveTextContent("25")
		expect(screen.getByTestId("cache-reads")).toHaveTextContent("10")
	})
})
