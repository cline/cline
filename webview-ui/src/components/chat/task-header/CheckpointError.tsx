import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
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
		<div className="flex items-center gap-1 py-1 px-1 bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded justify-between">
			<div className="flex gap-1 opacity-80">
				<i className="codicon codicon-warning" />
				<div className="flex gap-1">
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
						<a
							className="text-link underline"
							href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
							See instructions
						</a>
					)}
				</div>
			</div>
			<VSCodeButton
				appearance="icon"
				aria-label="Dismiss"
				className="opacity-100 hover:bg-transparent hover:opacity-80 p-0"
				onClick={() => setDismissed(true)}>
				<XIcon size={12} />
			</VSCodeButton>
		</div>
	)
}
