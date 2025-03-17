import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
}

export const CheckpointSaved = ({ checkpoint, ...props }: CheckpointSavedProps) => {
	const { t } = useTranslation()
	const isCurrent = props.currentHash === props.commitHash

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success) {
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
				<span className="font-bold">
					{metadata.isFirst ? t("chat:checkpoint.initial") : t("chat:checkpoint.regular")}
				</span>
				{isCurrent && <span className="text-muted text-sm">{t("chat:checkpoint.current")}</span>}
			</div>
			<CheckpointMenu {...props} checkpoint={metadata} />
		</div>
	)
}
