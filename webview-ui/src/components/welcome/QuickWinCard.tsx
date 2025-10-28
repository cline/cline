import React from "react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const renderIcon = (iconName?: string) => {
	if (!iconName) {
		return <span className="codicon codicon-rocket text-[28px]! leading-none!"></span>
	}

	let iconClass = "codicon-rocket"
	switch (iconName) {
		case "WebAppIcon":
			iconClass = "codicon-dashboard"
			break
		case "TerminalIcon":
			iconClass = "codicon-terminal"
			break
		case "GameIcon":
			iconClass = "codicon-game"
			break
		default:
			break
	}
	return <span className={`codicon ${iconClass} text-[28px]! leading-none!`}></span>
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<div
			className="flex items-center mb-2 py-0 px-5 space-x-3 rounded-full cursor-pointer group transition-colors duration-150 ease-in-out bg-white/2 border border-(--vscode-panel-border) hover:bg-(--vscode-list-hoverBackground)"
			onClick={() => onExecute()}>
			<div className="shrink-0 flex items-center justify-center w-6 h-6 text-(--vscode-icon-foreground)">
				{renderIcon(task.icon)}
			</div>

			<div className="grow min-w-0">
				<h3 className="text-sm font-medium truncate text-(--vscode-editor-foreground) leading-tight mb-0 mt-0 pt-3">
					{task.title}
				</h3>
				<p className="text-xs truncate text-(--vscode-descriptionForeground) leading-tight mt-px">{task.description}</p>
			</div>
		</div>
	)
}

export default QuickWinCard
