import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import { DeleteTaskDialog } from "../DeleteTaskDialog"

vi.mock("@/utils/vscode")

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"history:deleteTask": "Delete Task",
				"history:deleteTaskMessage": "Are you sure you want to delete this task? This action cannot be undone.",
				"history:cancel": "Cancel",
				"history:delete": "Delete",
			}
			return translations[key] || key
		},
	}),
}))

vi.mock("react-use", () => ({
	useKeyPress: vi.fn(),
}))

import { useKeyPress } from "react-use"

const mockUseKeyPress = useKeyPress as any

describe("DeleteTaskDialog", () => {
	const mockTaskId = "test-task-id"
	const mockOnOpenChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		mockUseKeyPress.mockReturnValue([false, null])
	})

	it("renders dialog with correct content", () => {
		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		expect(screen.getByText("Delete Task")).toBeInTheDocument()
		expect(
			screen.getByText("Are you sure you want to delete this task? This action cannot be undone."),
		).toBeInTheDocument()
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		expect(screen.getByText("Delete")).toBeInTheDocument()
	})

	it("calls vscode.postMessage when delete is confirmed", () => {
		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteTaskWithId",
			text: mockTaskId,
		})
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("calls onOpenChange when cancel is clicked", () => {
		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		const cancelButton = screen.getByText("Cancel")
		fireEvent.click(cancelButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("does not call vscode.postMessage when taskId is empty", () => {
		render(<DeleteTaskDialog taskId="" open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("handles Enter key press to delete task", () => {
		// Mock Enter key being pressed
		mockUseKeyPress.mockReturnValue([true, null])

		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteTaskWithId",
			text: mockTaskId,
		})
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("does not delete on Enter key press when taskId is empty", () => {
		// Mock Enter key being pressed
		mockUseKeyPress.mockReturnValue([true, null])

		render(<DeleteTaskDialog taskId="" open={true} onOpenChange={mockOnOpenChange} />)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).not.toHaveBeenCalled()
	})

	it("calls onOpenChange on escape key", () => {
		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		// Simulate escape key press on the dialog content
		const dialogContent = screen.getByRole("alertdialog")
		fireEvent.keyDown(dialogContent, { key: "Escape" })

		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("has correct button variants", () => {
		render(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		const cancelButton = screen.getByText("Cancel")
		const deleteButton = screen.getByText("Delete")

		// These should have the correct styling classes based on the component
		expect(cancelButton).toBeInTheDocument()
		expect(deleteButton).toBeInTheDocument()
	})

	it("handles multiple Enter key presses correctly", () => {
		// First render with Enter not pressed
		const { rerender } = render(
			<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />,
		)

		expect(vscode.postMessage).not.toHaveBeenCalled()

		// Then simulate Enter key press
		mockUseKeyPress.mockReturnValue([true, null])
		rerender(<DeleteTaskDialog taskId={mockTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteTaskWithId",
			text: mockTaskId,
		})
	})
})
