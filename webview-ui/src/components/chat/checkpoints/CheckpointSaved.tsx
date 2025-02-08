import { CheckpointMenu } from "./CheckpointMenu"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
}

export const CheckpointSaved = (props: CheckpointSavedProps) => (
	<div className="flex items-center justify-between">
		<div className="flex items-center gap-2">
			<span className="codicon codicon-git-commit text-blue-400" />
			<span className="font-bold">Checkpoint</span>
		</div>
		<CheckpointMenu {...props} />
	</div>
)
