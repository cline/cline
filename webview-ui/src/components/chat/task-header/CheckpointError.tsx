import { Alert } from "@heroui/react"
import { XIcon } from "lucide-react"
import { useMemo, useState } from "react"
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
		const showDisableButton =
			checkpointManagerErrorMessage?.endsWith("disabling checkpoints.") ||
			checkpointManagerErrorMessage?.includes("multi-root workspaces")
		const showGitInstructions = checkpointManagerErrorMessage?.includes("Git must be installed to use checkpoints.")
		return { message, showDisableButton, showGitInstructions }
	}, [checkpointManagerErrorMessage])

	if (!checkpointManagerErrorMessage || dismissed) {
		return null
	}
	return (
		<div className="flex items-center justify-center w-full">
			<Alert
				className="relative rounded-sm text-base h-fit bg-input-error-background text-input-error-foreground px-2 border border-foreground/30 py-1 px-2"
				color="warning"
				description={
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
				}
				endContent={
					<Button
						aria-label="Dismiss"
						className="absolute top-0.5 right-2 opacity-70 hover:opacity-100 p-1"
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							setDismissed(true)
						}}
						size="icon"
						variant="icon">
						<XIcon />
					</Button>
				}
				hideIcon={true}
				isVisible={!dismissed}
				title={messages.message}
				variant="faded"
			/>
		</div>
	)
}
