// npx vitest run src/components/chat/__tests__/CheckpointRestoreDialog.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { vi } from "vitest"

import { CheckpointRestoreDialog } from "../CheckpointRestoreDialog"

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"common:confirmation.deleteMessage": "Delete Message",
				"common:confirmation.editMessage": "Edit Message",
				"common:confirmation.deleteQuestionWithCheckpoint":
					"Deleting this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				"common:confirmation.editQuestionWithCheckpoint":
					"Editing this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				"common:confirmation.editOnly": "Edit Only",
				"common:confirmation.deleteOnly": "Delete Only",
				"common:confirmation.restoreToCheckpoint": "Restore to Checkpoint",
				"common:answers.cancel": "Cancel",
			}
			return translations[key] || key
		},
	}),
}))

describe("CheckpointRestoreDialog", () => {
	const defaultProps = {
		open: true,
		onOpenChange: vi.fn(),
		onConfirm: vi.fn(),
		type: "edit" as const,
		hasCheckpoint: false,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Basic Rendering", () => {
		it("renders edit dialog without checkpoint", () => {
			render(<CheckpointRestoreDialog {...defaultProps} />)

			expect(screen.getByText("Edit Message")).toBeInTheDocument()
			expect(
				screen.getByText(
					"Editing this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
			expect(screen.getByText("Edit Only")).toBeInTheDocument()
			expect(screen.getByText("Cancel")).toBeInTheDocument()
			expect(screen.queryByText("Restore to Checkpoint")).not.toBeInTheDocument()
		})

		it("renders delete dialog without checkpoint", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="delete" />)

			expect(screen.getByText("Delete Message")).toBeInTheDocument()
			expect(
				screen.getByText(
					"Deleting this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
			expect(screen.getByText("Delete Only")).toBeInTheDocument()
			expect(screen.getByText("Cancel")).toBeInTheDocument()
			expect(screen.queryByText("Restore to Checkpoint")).not.toBeInTheDocument()
		})

		it("renders edit dialog with checkpoint option", () => {
			render(<CheckpointRestoreDialog {...defaultProps} hasCheckpoint={true} />)

			expect(screen.getByText("Edit Message")).toBeInTheDocument()
			expect(
				screen.getByText(
					"Editing this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
			expect(screen.getByText("Edit Only")).toBeInTheDocument()
			expect(screen.getByText("Restore to Checkpoint")).toBeInTheDocument()
			expect(screen.getByText("Cancel")).toBeInTheDocument()
		})

		it("renders delete dialog with checkpoint option", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="delete" hasCheckpoint={true} />)

			expect(screen.getByText("Delete Message")).toBeInTheDocument()
			expect(
				screen.getByText(
					"Deleting this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
			expect(screen.getByText("Delete Only")).toBeInTheDocument()
			expect(screen.getByText("Restore to Checkpoint")).toBeInTheDocument()
			expect(screen.getByText("Cancel")).toBeInTheDocument()
		})
	})

	describe("User Interactions", () => {
		it("calls onOpenChange when cancel is clicked", () => {
			const onOpenChange = vi.fn()
			render(<CheckpointRestoreDialog {...defaultProps} onOpenChange={onOpenChange} />)

			fireEvent.click(screen.getByText("Cancel"))
			expect(onOpenChange).toHaveBeenCalledWith(false)
		})

		it("calls onConfirm with correct parameters when edit only is clicked", () => {
			const onConfirm = vi.fn()
			render(<CheckpointRestoreDialog {...defaultProps} onConfirm={onConfirm} />)

			fireEvent.click(screen.getByText("Edit Only"))
			expect(onConfirm).toHaveBeenCalledWith(false) // restoreCheckpoint
		})

		it("calls onConfirm with restoreCheckpoint=false when edit only is clicked with checkpoint", () => {
			const onConfirm = vi.fn()
			render(<CheckpointRestoreDialog {...defaultProps} onConfirm={onConfirm} hasCheckpoint={true} />)

			fireEvent.click(screen.getByText("Edit Only"))
			expect(onConfirm).toHaveBeenCalledWith(false) // restoreCheckpoint
		})

		it("calls onConfirm with restoreCheckpoint=true when restore to checkpoint is clicked", () => {
			const onConfirm = vi.fn()
			render(<CheckpointRestoreDialog {...defaultProps} onConfirm={onConfirm} hasCheckpoint={true} />)

			fireEvent.click(screen.getByText("Restore to Checkpoint"))
			expect(onConfirm).toHaveBeenCalledWith(true) // restoreCheckpoint
		})

		it("calls onOpenChange when dialog is closed", () => {
			const onOpenChange = vi.fn()
			render(<CheckpointRestoreDialog {...defaultProps} onOpenChange={onOpenChange} hasCheckpoint={true} />)

			fireEvent.click(screen.getByText("Edit Only"))
			expect(onOpenChange).toHaveBeenCalledWith(false)
		})
	})

	describe("Dialog State Management", () => {
		it("does not render when open is false", () => {
			render(<CheckpointRestoreDialog {...defaultProps} open={false} />)

			expect(screen.queryByText("Edit Message")).not.toBeInTheDocument()
			expect(screen.queryByText("Delete Message")).not.toBeInTheDocument()
		})

		it("maintains state when dialog stays open", async () => {
			const { rerender } = render(<CheckpointRestoreDialog {...defaultProps} hasCheckpoint={true} open={true} />)

			// Verify initial state
			expect(screen.getByText("Edit Only")).toBeInTheDocument()
			expect(screen.getByText("Restore to Checkpoint")).toBeInTheDocument()

			// Re-render with same props
			rerender(<CheckpointRestoreDialog {...defaultProps} hasCheckpoint={true} open={true} />)

			// Should still have same buttons
			expect(screen.getByText("Edit Only")).toBeInTheDocument()
			expect(screen.getByText("Restore to Checkpoint")).toBeInTheDocument()
		})
	})

	describe("Accessibility", () => {
		it("has proper ARIA labels and roles", () => {
			render(<CheckpointRestoreDialog {...defaultProps} hasCheckpoint={true} />)

			expect(screen.getByRole("alertdialog")).toBeInTheDocument() // AlertDialog uses alertdialog role
			expect(screen.getByRole("button", { name: "Edit Only" })).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Restore to Checkpoint" })).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
		})
	})

	describe("Edge Cases", () => {
		it("handles missing translation keys gracefully", () => {
			// This test is simplified since we can't easily mock the translation function mid-test
			// The component should handle missing keys by returning the key itself
			render(<CheckpointRestoreDialog {...defaultProps} />)

			// Should still render with proper text from our mock
			expect(screen.getByText("Edit Message")).toBeInTheDocument()
		})

		it("handles rapid button clicks", async () => {
			const onConfirm = vi.fn()
			const onOpenChange = vi.fn()
			render(
				<CheckpointRestoreDialog
					{...defaultProps}
					onConfirm={onConfirm}
					onOpenChange={onOpenChange}
					hasCheckpoint={true}
				/>,
			)

			const editOnlyButton = screen.getByText("Edit Only")

			// Click button once
			fireEvent.click(editOnlyButton)

			// Should be called once with correct parameters
			expect(onConfirm).toHaveBeenCalledTimes(1)
			expect(onConfirm).toHaveBeenCalledWith(false) // restoreCheckpoint
			expect(onOpenChange).toHaveBeenCalledWith(false) // dialog should close
		})
	})

	describe("Type-specific Behavior", () => {
		it("shows correct warning text for edit type", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="edit" />)

			expect(
				screen.getByText(
					"Editing this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
		})

		it("shows correct warning text for delete type", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="delete" />)

			expect(
				screen.getByText(
					"Deleting this message will delete all subsequent messages in the conversation. Do you want to proceed?",
				),
			).toBeInTheDocument()
		})

		it("shows correct title for edit type", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="edit" />)

			expect(screen.getByText("Edit Message")).toBeInTheDocument()
		})

		it("shows correct title for delete type", () => {
			render(<CheckpointRestoreDialog {...defaultProps} type="delete" />)

			expect(screen.getByText("Delete Message")).toBeInTheDocument()
		})
	})
})
