import { render, screen, fireEvent } from "@testing-library/react"
import { BatchDeleteTaskDialog } from "../BatchDeleteTaskDialog"
import { vscode } from "@/utils/vscode"

jest.mock("@/utils/vscode")
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => {
			const translations: Record<string, string> = {
				"history:deleteTasks": "Delete Tasks",
				"history:confirmDeleteTasks": `Are you sure you want to delete ${options?.count || 0} tasks?`,
				"history:deleteTasksWarning": "This action cannot be undone.",
				"history:cancel": "Cancel",
				"history:deleteItems": `Delete ${options?.count || 0} items`,
			}
			return translations[key] || key
		},
	}),
}))

describe("BatchDeleteTaskDialog", () => {
	const mockTaskIds = ["task-1", "task-2", "task-3"]
	const mockOnOpenChange = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders dialog with correct content", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		expect(screen.getByText("Delete Tasks")).toBeInTheDocument()
		expect(screen.getByText("Are you sure you want to delete 3 tasks?")).toBeInTheDocument()
		expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument()
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		expect(screen.getByText("Delete 3 items")).toBeInTheDocument()
	})

	it("calls vscode.postMessage when delete is confirmed", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 3 items")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteMultipleTasksWithIds",
			ids: mockTaskIds,
		})
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("calls onOpenChange when cancel is clicked", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const cancelButton = screen.getByText("Cancel")
		fireEvent.click(cancelButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("does not call vscode.postMessage when taskIds is empty", () => {
		render(<BatchDeleteTaskDialog taskIds={[]} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 0 items")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("renders with correct task count in messages", () => {
		const singleTaskId = ["task-1"]
		render(<BatchDeleteTaskDialog taskIds={singleTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		expect(screen.getByText("Are you sure you want to delete 1 tasks?")).toBeInTheDocument()
		expect(screen.getByText("Delete 1 items")).toBeInTheDocument()
	})

	it("renders trash icon in delete button", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 3 items")
		const trashIcon = deleteButton.querySelector(".codicon-trash")
		expect(trashIcon).toBeInTheDocument()
	})
})
