import { Alert } from "@heroui/react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import { useMemo, useState } from "react"

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
				className="rounded-sm border-0 bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] pl-1 pr-1.5 py-1"
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
					<VSCodeButton
						appearance="icon"
						aria-label="Dismiss"
						className="inline-flex opacity-100 hover:bg-transparent hover:opacity-60 p-0"
						onClick={() => setDismissed(true)}
						title="Dismiss Checkpoint Error">
						<XIcon size={12} />
					</VSCodeButton>
				}
				hideIconWrapper={true}
				isVisible={!dismissed}
				title={messages.message}
				variant="faded"
			/>
		</div>
	)
}
