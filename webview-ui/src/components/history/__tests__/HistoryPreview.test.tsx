import { render, screen } from "@testing-library/react"
import HistoryPreview from "../HistoryPreview"
import type { HistoryItem } from "@roo-code/types"

jest.mock("../useTaskSearch")
jest.mock("../TaskItem", () => {
	return {
		__esModule: true,
		default: jest.fn(({ item, variant }) => (
			<div data-testid={`task-item-${item.id}`} data-variant={variant}>
				{item.task}
			</div>
		)),
	}
})

import { useTaskSearch } from "../useTaskSearch"
import TaskItem from "../TaskItem"

const mockUseTaskSearch = useTaskSearch as jest.MockedFunction<typeof useTaskSearch>
const mockTaskItem = TaskItem as jest.MockedFunction<typeof TaskItem>

const mockTasks: HistoryItem[] = [
	{
		id: "task-1",
		number: 1,
		task: "First task",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
	},
	{
		id: "task-2",
		number: 2,
		task: "Second task",
		ts: Date.now(),
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.02,
	},
	{
		id: "task-3",
		number: 3,
		task: "Third task",
		ts: Date.now(),
		tokensIn: 150,
		tokensOut: 75,
		totalCost: 0.015,
	},
	{
		id: "task-4",
		number: 4,
		task: "Fourth task",
		ts: Date.now(),
		tokensIn: 300,
		tokensOut: 150,
		totalCost: 0.03,
	},
]

describe("HistoryPreview", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders nothing when no tasks are available", () => {
		mockUseTaskSearch.mockReturnValue({
			tasks: [],
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		const { container } = render(<HistoryPreview />)

		// Should render the container but no task items
		expect(container.firstChild).toHaveClass("flex", "flex-col", "gap-3")
		expect(screen.queryByTestId(/task-item-/)).not.toBeInTheDocument()
	})

	it("renders up to 3 tasks when tasks are available", () => {
		mockUseTaskSearch.mockReturnValue({
			tasks: mockTasks,
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		render(<HistoryPreview />)

		// Should render only the first 3 tasks
		expect(screen.getByTestId("task-item-task-1")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-task-2")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-task-3")).toBeInTheDocument()
		expect(screen.queryByTestId("task-item-task-4")).not.toBeInTheDocument()
	})

	it("renders all tasks when there are 3 or fewer", () => {
		const threeTasks = mockTasks.slice(0, 3)
		mockUseTaskSearch.mockReturnValue({
			tasks: threeTasks,
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		render(<HistoryPreview />)

		expect(screen.getByTestId("task-item-task-1")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-task-2")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-task-3")).toBeInTheDocument()
	})

	it("renders only 1 task when there is only 1 task", () => {
		const oneTask = mockTasks.slice(0, 1)
		mockUseTaskSearch.mockReturnValue({
			tasks: oneTask,
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		render(<HistoryPreview />)

		expect(screen.getByTestId("task-item-task-1")).toBeInTheDocument()
		expect(screen.queryByTestId("task-item-task-2")).not.toBeInTheDocument()
	})

	it("passes correct props to TaskItem components", () => {
		mockUseTaskSearch.mockReturnValue({
			tasks: mockTasks.slice(0, 2),
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		render(<HistoryPreview />)

		// Verify TaskItem was called with correct props
		expect(mockTaskItem).toHaveBeenCalledWith(
			expect.objectContaining({
				item: mockTasks[0],
				variant: "compact",
			}),
			expect.anything(),
		)
		expect(mockTaskItem).toHaveBeenCalledWith(
			expect.objectContaining({
				item: mockTasks[1],
				variant: "compact",
			}),
			expect.anything(),
		)
	})

	it("renders with correct container classes", () => {
		mockUseTaskSearch.mockReturnValue({
			tasks: mockTasks.slice(0, 1),
			searchQuery: "",
			setSearchQuery: jest.fn(),
			sortOption: "newest",
			setSortOption: jest.fn(),
			lastNonRelevantSort: null,
			setLastNonRelevantSort: jest.fn(),
			showAllWorkspaces: false,
			setShowAllWorkspaces: jest.fn(),
		})

		const { container } = render(<HistoryPreview />)

		expect(container.firstChild).toHaveClass("flex", "flex-col", "gap-3")
	})
})
