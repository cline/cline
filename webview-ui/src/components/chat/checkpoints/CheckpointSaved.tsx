import { useMemo } from "react"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	checkpoint?: Record<string, unknown>
	currentCheckpointHash?: string
}

export const CheckpointSaved = ({ checkpoint, ...props }: CheckpointSavedProps) => {
	const isCurrent = props.currentCheckpointHash === props.commitHash

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)
		return result.success ? result.data : undefined
	}, [checkpoint])

	const isFirst = !!metadata?.isFirst

	return (
		<div className="flex items-center justify-between">
			<div className="flex gap-2">
				<span className="codicon codicon-git-commit text-blue-400" />
				<span className="font-bold">{isFirst ? "Initial Checkpoint" : "Checkpoint"}</span>
				{isCurrent && <span className="text-muted text-sm">Current</span>}
			</div>
			<CheckpointMenu {...props} checkpoint={metadata} />
		</div>
	)
}
