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

interface DeleteModeDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	modeToDelete: {
		slug: string
		name: string
		source?: string
		rulesFolderPath?: string
	} | null
	onConfirm: () => void
}

export const DeleteModeDialog: React.FC<DeleteModeDialogProps> = ({ open, onOpenChange, modeToDelete, onConfirm }) => {
	const { t } = useAppTranslation()

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("prompts:deleteMode.title")}</AlertDialogTitle>
					<AlertDialogDescription>
						{modeToDelete && (
							<>
								{t("prompts:deleteMode.message", { modeName: modeToDelete.name })}
								{modeToDelete.rulesFolderPath && (
									<div className="mt-2">
										{t("prompts:deleteMode.rulesFolder", {
											folderPath: modeToDelete.rulesFolderPath,
										})}
									</div>
								)}
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("prompts:deleteMode.cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>{t("prompts:deleteMode.confirm")}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
