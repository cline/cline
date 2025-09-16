import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { TriangleAlertIcon, XIcon } from "lucide-react"
import { useState } from "react"

interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}
export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	const [dismissed, setDismissed] = useState(false)
	if (!checkpointManagerErrorMessage || dismissed) {
		return null
	}

	return (
		<div className="flex items-center p-1 bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded-sm justify-between">
			<div className="flex gap-1 items-center opacity-80">
				<TriangleAlertIcon size={14} />
				<span>
					{checkpointManagerErrorMessage.replace(/disabling checkpoints\.$/, "")}
					{checkpointManagerErrorMessage.endsWith("disabling checkpoints.") && (
						<button
							className="underline cursor-pointer bg-transparent border-0 p-0 text-inherit"
							onClick={handleCheckpointSettingsClick}>
							disabling checkpoints.
						</button>
					)}
				</span>
				{checkpointManagerErrorMessage.includes("Git must be installed to use checkpoints.") && (
					<a className="text-link underline" href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
						See instructions
					</a>
				)}
			</div>
			<VSCodeButton
				appearance="icon"
				aria-label="Dismiss"
				className="inline-flex opacity-100 hover:bg-transparent hover:opacity-80 p-0"
				onClick={() => setDismissed(true)}>
				<XIcon size={12} />
			</VSCodeButton>
		</div>
	)
}
