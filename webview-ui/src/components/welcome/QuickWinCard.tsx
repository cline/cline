import React from "react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const renderIcon = (iconName?: string) => {
	if (!iconName) return <span className="codicon codicon-rocket text-lg"></span>

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
	return <span className={`codicon ${iconClass} text-lg`}></span>
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<div
			className="flex items-center p-1 space-x-1.5 rounded-full cursor-pointer group transition-colors duration-150 ease-in-out bg-[var(--vscode-sideBar-background)] border border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={() => onExecute()}>
			<div className="flex-shrink-0 flex items-center justify-center w-5 h-5 text-[var(--vscode-icon-foreground)]">
				{renderIcon(task.icon)}
			</div>

			<div className="flex-grow min-w-0">
				<h3 className="text-xs font-medium truncate text-[var(--vscode-editor-foreground)]">{task.title}</h3>
				<p className="text-xs truncate text-[var(--vscode-descriptionForeground)]">{task.description}</p>
			</div>
		</div>
	)
}

export default QuickWinCard
