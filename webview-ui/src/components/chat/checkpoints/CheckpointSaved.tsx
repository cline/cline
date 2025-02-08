import { CheckpointMenu } from "./CheckpointMenu"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentCheckpointHash?: string
}

export const CheckpointSaved = (props: CheckpointSavedProps) => {
	const isCurrent = props.currentCheckpointHash === props.commitHash

	return (
		<div className="flex items-center justify-between">
			<div className="flex gap-2">
				<span className="codicon codicon-git-commit text-blue-400" />
				<span className="font-bold">Checkpoint</span>
				{isCurrent && <span className="text-muted text-sm">Current</span>}
			</div>
			<CheckpointMenu {...props} />
		</div>
	)
}
