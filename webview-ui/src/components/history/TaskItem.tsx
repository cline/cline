import { memo } from "react"
import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { useAppTranslation } from "@/i18n/TranslationContext"

import TaskItemHeader from "./TaskItemHeader"
import TaskItemFooter from "./TaskItemFooter"

interface TaskItemProps {
	item: HistoryItem
	variant: "compact" | "full"
	showWorkspace?: boolean
	isSelectionMode?: boolean
	isSelected?: boolean
	onToggleSelection?: (taskId: string, isSelected: boolean) => void
	onDelete?: (taskId: string) => void
	className?: string
}

const TaskItem = ({
	item,
	variant,
	showWorkspace = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelection,
	onDelete,
	className,
}: TaskItemProps) => {
	const { t } = useAppTranslation()

	const handleClick = () => {
		if (isSelectionMode && onToggleSelection) {
			onToggleSelection(item.id, !isSelected)
		} else {
			vscode.postMessage({ type: "showTaskWithId", text: item.id })
		}
	}

	const isCompact = variant === "compact"

	return (
		<div
			key={item.id}
			data-testid={isCompact ? undefined : `task-item-${item.id}`}
			className={cn(
				"cursor-pointer",
				{
					// Compact variant styling
					"bg-vscode-editor-background rounded relative overflow-hidden border border-vscode-toolbar-hoverBackground/30 hover:border-vscode-toolbar-hoverBackground/60":
						isCompact,
					// Full variant styling
					"bg-vscode-list-activeSelectionBackground": !isCompact && isSelectionMode && isSelected,
				},
				className,
			)}
			onClick={handleClick}>
			<div
				className={cn("flex gap-2", {
					"flex-col p-3 pt-1": isCompact,
					"items-start p-3 ml-2": !isCompact,
				})}>
				{/* Selection checkbox - only in full variant */}
				{!isCompact && isSelectionMode && (
					<div
						className="task-checkbox mt-1"
						onClick={(e) => {
							e.stopPropagation()
						}}>
						<Checkbox
							checked={isSelected}
							onCheckedChange={(checked: boolean) => onToggleSelection?.(item.id, checked === true)}
							variant="description"
						/>
					</div>
				)}

				<div className="flex-1">
					{/* Header with metadata */}
					<TaskItemHeader
						item={item}
						variant={variant}
						isSelectionMode={isSelectionMode}
						t={t}
						onDelete={onDelete}
					/>

					{/* Task content */}
					<div
						className={cn("overflow-hidden whitespace-pre-wrap", {
							"text-vscode-foreground": isCompact,
						})}
						style={{
							fontSize: isCompact ? undefined : "var(--vscode-font-size)",
							color: isCompact ? undefined : "var(--vscode-foreground)",
							display: "-webkit-box",
							WebkitLineClamp: isCompact ? 2 : 3,
							WebkitBoxOrient: "vertical",
							wordBreak: "break-word",
							overflowWrap: "anywhere",
						}}
						data-testid={isCompact ? undefined : "task-content"}
						{...(isCompact ? {} : { dangerouslySetInnerHTML: { __html: item.task } })}>
						{isCompact ? item.task : undefined}
					</div>

					{/* Task Item Footer */}
					<TaskItemFooter item={item} variant={variant} isSelectionMode={isSelectionMode} />

					{/* Workspace info */}
					{showWorkspace && item.workspace && (
						<div
							className={cn("flex flex-row gap-1 text-vscode-descriptionForeground text-xs", {
								"mt-1": isCompact,
							})}>
							<span className="codicon codicon-folder scale-80" />
							<span>{item.workspace}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default memo(TaskItem)
