interface CheckpointErrorProps {
	checkpointManagerErrorMessage?: string
	handleCheckpointSettingsClick: () => void
}
export const CheckpointError: React.FC<CheckpointErrorProps> = ({
	checkpointManagerErrorMessage,
	handleCheckpointSettingsClick,
}) => {
	if (!checkpointManagerErrorMessage) {
		return null
	}

	return (
		<div className="flex items-center gap-1 p-2 bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded">
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
					<a className="text-link underline" href="https://github.com/cline/cline/wiki/Installing-Git-for-Checkpoints">
						See instructions
					</a>
				)}
			</div>
		</div>
	)
}
