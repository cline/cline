import { render, screen, fireEvent } from "@testing-library/react"
import TaskItem from "../TaskItem"

jest.mock("@src/utils/vscode")
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockTask = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

describe("TaskItem", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders task information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={jest.fn()}
				isSelectionMode={false}
			/>,
		)

		expect(screen.getByText("Test task")).toBeInTheDocument()
		expect(screen.getByText("$0.00")).toBeInTheDocument() // Component shows $0.00 for small amounts
	})

	it("handles selection in selection mode", () => {
		const onToggleSelection = jest.fn()
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={onToggleSelection}
				isSelectionMode={true}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onToggleSelection).toHaveBeenCalledWith("1", true)
	})

	it("shows action buttons", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={jest.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("displays cache information when present", () => {
		const mockTaskWithCache = {
			...mockTask,
			cacheReads: 10,
			cacheWrites: 5,
		}

		render(
			<TaskItem
				item={mockTaskWithCache}
				variant="full"
				isSelected={false}
				onToggleSelection={jest.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should display cache information in the footer
		expect(screen.getByTestId("cache-compact")).toBeInTheDocument()
		expect(screen.getByText("5")).toBeInTheDocument() // cache writes
		expect(screen.getByText("10")).toBeInTheDocument() // cache reads
	})

	it("does not display cache information when not present", () => {
		const mockTaskWithoutCache = {
			...mockTask,
			cacheReads: 0,
			cacheWrites: 0,
		}

		render(
			<TaskItem
				item={mockTaskWithoutCache}
				variant="full"
				isSelected={false}
				onToggleSelection={jest.fn()}
				isSelectionMode={false}
			/>,
		)

		// Cache section should not be present
		expect(screen.queryByTestId("cache-compact")).not.toBeInTheDocument()
	})
})
