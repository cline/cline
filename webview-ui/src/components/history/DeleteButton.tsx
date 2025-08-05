import { useCallback } from "react"

import { Button, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

type DeleteButtonProps = {
	itemId: string
	onDelete?: (taskId: string) => void
}

export const DeleteButton = ({ itemId, onDelete }: DeleteButtonProps) => {
	const { t } = useAppTranslation()

	const handleDeleteClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (e.shiftKey) {
				vscode.postMessage({ type: "deleteTaskWithId", text: itemId })
			} else if (onDelete) {
				onDelete(itemId)
			}
		},
		[itemId, onDelete],
	)

	return (
		<StandardTooltip content={t("history:deleteTaskTitle")}>
			<Button
				variant="ghost"
				size="icon"
				data-testid="delete-task-button"
				onClick={handleDeleteClick}
				className="opacity-70">
				<span className="codicon codicon-trash size-4 align-middle text-vscode-descriptionForeground" />
			</Button>
		</StandardTooltip>
	)
}
