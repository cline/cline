import React from "react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const renderIcon = (iconName?: string) => {
	if (!iconName) return <span className="codicon codicon-rocket text-lg"></span> // Default icon, reduced size

	let iconClass = "codicon-rocket" // Default icon
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
	return <span className={`codicon ${iconClass} text-lg`}></span> // Reduced size
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<div
			className="flex items-center p-1 space-x-1.5 rounded-full cursor-pointer group transition-colors duration-150 ease-in-out" // Reduced padding and space
			style={{
				backgroundColor: "var(--vscode-sideBar-background)", // Darker background
				border: "1px solid var(--vscode-panel-border)", // Changed to grayish border
			}}
			onClick={() => onExecute()}
			onMouseEnter={(e) => {
				e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)"
				e.currentTarget.style.borderColor = "var(--vscode-panel-border)" // Changed to grayish border on hover
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.backgroundColor = "var(--vscode-sideBar-background)"
				e.currentTarget.style.borderColor = "var(--vscode-panel-border)" // Changed to grayish border
			}}>
			{/* Icon Container - no background, icon color from text color */}
			<div
				className="flex-shrink-0 flex items-center justify-center w-5 h-5" // Reduced container size
				style={{ color: "var(--vscode-icon-foreground)" }}>
				{renderIcon(task.icon)}
			</div>

			{/* Headline (Title) and Subheadline (Description) */}
			<div className="flex-grow min-w-0">
				<h3
					className="text-xs font-medium truncate" // Reduced title size
					style={{ color: "var(--vscode-editor-foreground)" }}>
					{task.title}
				</h3>
				<p
					className="text-xs truncate" // Kept description size, ensure leading is tight if needed
					style={{ color: "var(--vscode-descriptionForeground)" }}>
					{task.description}
				</p>
			</div>
			{/* Chevron Icon Removed */}
		</div>
	)
}

export default QuickWinCard
