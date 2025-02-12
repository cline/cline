import { useMemo } from "react"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"

const REQUIRED_VERSION = 1

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
}

export const CheckpointSaved = ({ checkpoint, ...props }: CheckpointSavedProps) => {
	const isCurrent = props.currentHash === props.commitHash

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success || result.data.version < REQUIRED_VERSION) {
			return undefined
		}

		return result.data
	}, [checkpoint])

	if (!metadata) {
		return null
	}

	return (
		<div className="flex items-center justify-between">
			<div className="flex gap-2">
				<span className="codicon codicon-git-commit text-blue-400" />
				<span className="font-bold">{metadata.isFirst ? "Initial Checkpoint" : "Checkpoint"}</span>
				{isCurrent && <span className="text-muted text-sm">Current</span>}
			</div>
			<CheckpointMenu {...props} checkpoint={metadata} />
		</div>
	)
}
