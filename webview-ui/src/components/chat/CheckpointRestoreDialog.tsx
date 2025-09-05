import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@src/components/ui"

interface CheckpointRestoreDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: (restoreCheckpoint: boolean) => void
	type: "edit" | "delete"
	hasCheckpoint: boolean
}

export const CheckpointRestoreDialog: React.FC<CheckpointRestoreDialogProps> = ({
	open,
	onOpenChange,
	onConfirm,
	type,
	hasCheckpoint,
}) => {
	const { t } = useAppTranslation()

	const isEdit = type === "edit"
	const title = isEdit ? t("common:confirmation.editMessage") : t("common:confirmation.deleteMessage")
	const description = isEdit
		? t("common:confirmation.editQuestionWithCheckpoint")
		: t("common:confirmation.deleteQuestionWithCheckpoint")

	const handleConfirmWithRestore = () => {
		onConfirm(true)
		onOpenChange(false)
	}

	const handleConfirmWithoutRestore = () => {
		onConfirm(false)
		onOpenChange(false)
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
					<AlertDialogDescription className="text-base">{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col gap-2">
					<AlertDialogCancel className="bg-vscode-button-secondaryBackground hover:bg-vscode-button-secondaryHoverBackground text-vscode-button-secondaryForeground border-vscode-button-border">
						{t("common:answers.cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirmWithoutRestore}
						className="bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground border-vscode-button-border">
						{isEdit ? t("common:confirmation.editOnly") : t("common:confirmation.deleteOnly")}
					</AlertDialogAction>
					{hasCheckpoint && (
						<AlertDialogAction
							onClick={handleConfirmWithRestore}
							className="bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground border-vscode-button-border">
							{t("common:confirmation.restoreToCheckpoint")}
						</AlertDialogAction>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

// Export convenience components for backward compatibility
export const EditMessageWithCheckpointDialog: React.FC<Omit<CheckpointRestoreDialogProps, "type">> = (props) => (
	<CheckpointRestoreDialog {...props} type="edit" />
)

export const DeleteMessageWithCheckpointDialog: React.FC<Omit<CheckpointRestoreDialogProps, "type">> = (props) => (
	<CheckpointRestoreDialog {...props} type="delete" />
)
