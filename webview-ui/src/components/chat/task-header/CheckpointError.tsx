import { useMemo } from "react"
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
	const messages = useMemo(() => {
		const message = checkpointManagerErrorMessage?.replace(/disabling checkpoints\.$/, "")
		const showDisableButton =
			checkpointManagerErrorMessage?.endsWith("disabling checkpoints.") ||
			checkpointManagerErrorMessage?.includes("multi-root workspaces")
		const showGitInstructions = checkpointManagerErrorMessage?.includes("Git must be installed to use checkpoints.")
		return { message, showDisableButton, showGitInstructions }
	}, [checkpointManagerErrorMessage])

	if (!checkpointManagerErrorMessage) {
		return null
	}

	return (
		<div className="flex items-center justify-center w-full">
			<Alert title={messages.message} variant="danger">
				<AlertDescription className="flex gap-2 justify-end">
					{messages.showDisableButton && (
						<Button aria-label="Disable Checkpoints" onClick={handleCheckpointSettingsClick} variant="ghost">
							Disable Checkpoints
						</Button>
					)}
					{messages.showGitInstructions && (
						<a
							className="text-link underline"
							href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
							See instructions
						</a>
					)}
				</AlertDescription>
			</Alert>
		</div>
	)
}
