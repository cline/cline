import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}
export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	const { t } = useTranslation()
	const messages = useMemo(() => {
		let message = checkpointManagerErrorMessage

		// Check for specific error messages from backend and translate them
		if (message?.includes("Cannot use checkpoints in home directory")) {
			message = t("task_header.cannot_use_checkpoints_in_home_directory")
		} else if (message?.includes("Cannot use checkpoints in Desktop directory")) {
			message = t("task_header.cannot_use_checkpoints_in_desktop_directory")
		} else if (message?.includes("Cannot use checkpoints in Documents directory")) {
			message = t("task_header.cannot_use_checkpoints_in_documents_directory")
		} else if (message?.includes("Cannot use checkpoints in Downloads directory")) {
			message = t("task_header.cannot_use_checkpoints_in_downloads_directory")
		} else {
			// Handle existing logic for other messages
			message = message?.replace(new RegExp(t("task_header.disabling_checkpoints_message") + "$"), "")
		}

		const showDisableButton =
			checkpointManagerErrorMessage?.endsWith("disabling checkpoints.") ||
			checkpointManagerErrorMessage?.includes("multi-root workspaces")
		const showGitInstructions = checkpointManagerErrorMessage?.includes("Git must be installed to use checkpoints.")
		return { message, showDisableButton, showGitInstructions }
	}, [checkpointManagerErrorMessage, t])

	if (!checkpointManagerErrorMessage) {
		return null
	}

	return (
		<div className="flex items-center justify-center w-full">
			<Alert title={messages.message} variant="danger">
				<AlertDescription className="flex gap-2 justify-end">
					{messages.showDisableButton && (
						<Button
							aria-label={t("task_header.disable_checkpoints")}
							onClick={handleCheckpointSettingsClick}
							variant="ghost">
							{t("task_header.disable_checkpoints")}
						</Button>
					)}
					{messages.showGitInstructions && (
						<a
							className="text-link underline"
							href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
							{t("task_header.see_instructions")}
						</a>
					)}
				</AlertDescription>
			</Alert>
		</div>
	)
}
