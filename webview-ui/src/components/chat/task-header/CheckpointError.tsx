import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AlertCircleIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}
export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	const [dismissed, setDismissed] = useState(false)

	const messages = useMemo(() => {
		const message = checkpointManagerErrorMessage?.replace(/disabling checkpoints\.$/, "")
		const showDisableButton = checkpointManagerErrorMessage?.endsWith("disabling checkpoints.")
		const showGitInstructions = checkpointManagerErrorMessage?.includes("Git must be installed to use checkpoints.")
		return { message, showDisableButton, showGitInstructions }
	}, [checkpointManagerErrorMessage])

	if (dismissed) {
		return null
	}
	return (
		<div className="flex items-center justify-center w-full opacity-80 hover:opacity-100 transition-opacity duration-200">
			<Alert className="relative w-full" variant="destructive">
				<AlertCircleIcon />
				<AlertTitle className="text-sm">{messages.message}Omg omg </AlertTitle>
				<AlertDescription className="text-xs">
					my name is
					{messages.showDisableButton && (
						<button
							className="underline cursor-pointer bg-transparent border-0 p-0 text-inherit"
							onClick={handleCheckpointSettingsClick}>
							Disable Checkpoints
						</button>
					)}
				</AlertDescription>
				<VSCodeButton
					appearance="icon"
					aria-label="Dismiss"
					className="absolute right-2 top-2"
					onClick={() => setDismissed(true)}
					title="Dismiss Checkpoint Error">
					<XIcon size={12} />
				</VSCodeButton>
			</Alert>
		</div>
	)
}
