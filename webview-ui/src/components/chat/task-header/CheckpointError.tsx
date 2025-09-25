import { AlertCircleIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

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

	if (dismissed || !messages?.message) {
		return null
	}
	return (
		<Alert
			className="relative w-full h-fit flex items-center opacity-80 hover:opacity-100 transition-opacity duration-200 justify-between"
			variant="error">
			<div className="flex items-center">
				<AlertCircleIcon size={12} />
				<AlertTitle className="flex text-xs items-end">{messages.message}</AlertTitle>
				<AlertDescription className="text-xs">
					<div className="flex gap-2">
						{messages.showDisableButton && (
							<button
								className="underline cursor-pointer bg-transparent border-0 p-0 text-inherit"
								onClick={handleCheckpointSettingsClick}>
								Disable Checkpoints
							</button>
						)}
						{messages.showGitInstructions && (
							<a
								className="text-link underline"
								href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
								See instructions
							</a>
						)}
					</div>
				</AlertDescription>
			</div>
			<Button aria-label="Dismiss" onClick={() => setDismissed(true)} title="Dismiss Checkpoint Error">
				<XIcon size={10} />
			</Button>
		</Alert>
	)
}
