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
			className="flex items-center p-1 space-x-1.5 rounded-full cursor-pointer group transition-colors duration-150 ease-in-out"
			style={{
				backgroundColor: "var(--vscode-sideBar-background)",
				border: "1px solid var(--vscode-panel-border)",
			}}
			onClick={() => onExecute()}
			onMouseEnter={(e) => {
				e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)"
				e.currentTarget.style.borderColor = "var(--vscode-panel-border)"
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.backgroundColor = "var(--vscode-sideBar-background)"
				e.currentTarget.style.borderColor = "var(--vscode-panel-border)"
			}}>
			<div
				className="flex-shrink-0 flex items-center justify-center w-5 h-5"
				style={{ color: "var(--vscode-icon-foreground)" }}>
				{renderIcon(task.icon)}
			</div>

			<div className="flex-grow min-w-0">
				<h3 className="text-xs font-medium truncate" style={{ color: "var(--vscode-editor-foreground)" }}>
					{task.title}
				</h3>
				<p className="text-xs truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
					{task.description}
				</p>
			</div>
		</div>
	)
}

export default QuickWinCard
