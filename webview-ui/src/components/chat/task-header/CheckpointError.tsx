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
		const message = checkpointManagerErrorMessage?.replace(
			new RegExp(t("task_header.disabling_checkpoints_message") + "$"),
			"",
		)
		const showDisableButton =
			checkpointManagerErrorMessage?.endsWith(t("task_header.disabling_checkpoints_message")) ||
			checkpointManagerErrorMessage?.includes(t("task_header.multi_root_message"))
		const showGitInstructions = checkpointManagerErrorMessage?.includes(t("task_header.git_instructions"))
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
