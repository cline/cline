import { useState } from "react"
import prettyBytes from "pretty-bytes"
import { useTranslation } from "react-i18next"

import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"

import { DeleteTaskDialog } from "../history/DeleteTaskDialog"
import { IconButton } from "./IconButton"
import { ShareButton } from "./ShareButton"

interface TaskActionsProps {
	item?: HistoryItem
	buttonsDisabled: boolean
}

export const TaskActions = ({ item, buttonsDisabled }: TaskActionsProps) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const { t } = useTranslation()

	return (
		<div className="flex flex-row gap-1">
			<ShareButton item={item} disabled={buttonsDisabled} />
			<IconButton
				iconClass="codicon-desktop-download"
				title={t("chat:task.export")}
				disabled={buttonsDisabled}
				onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
			/>
			{!!item?.size && item.size > 0 && (
				<>
					<div className="flex items-center">
						<IconButton
							iconClass="codicon-trash"
							title={t("chat:task.delete")}
							disabled={buttonsDisabled}
							onClick={(e) => {
								e.stopPropagation()

								if (e.shiftKey) {
									vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
								} else {
									setDeleteTaskId(item.id)
								}
							}}
						/>
						<span className="ml-1 text-xs text-vscode-foreground opacity-85">{prettyBytes(item.size)}</span>
					</div>
					{deleteTaskId && (
						<DeleteTaskDialog
							taskId={deleteTaskId}
							onOpenChange={(open) => !open && setDeleteTaskId(null)}
							open
						/>
					)}
				</>
			)}
		</div>
	)
}
