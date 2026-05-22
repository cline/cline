import { ChevronRight, Code2, Gamepad2, LayoutTemplate, Terminal } from "lucide-react"
import React from "react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const getIconConfig = (iconName?: string) => {
	switch (iconName) {
		case "WebAppIcon":
			return { Icon: LayoutTemplate, bg: "bg-aihydro-ocean-blue/15", color: "#6BB6FF" }
		case "TerminalIcon":
			return { Icon: Terminal, bg: "bg-aihydro-emerald/15", color: "#6ADE8F" }
		case "GameIcon":
			return { Icon: Gamepad2, bg: "bg-aihydro-teal/15", color: "#48D1CC" }
		default:
			return { Icon: Code2, bg: "bg-aihydro-cyan/15", color: "#20E3E3" }
	}
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	const { Icon, bg, color } = getIconConfig(task.icon)

	return (
		<div
			className="group flex items-center mb-2.5 py-3 px-4 rounded-xl cursor-pointer
				border border-[var(--vscode-panel-border)]/60 bg-[var(--vscode-editor-background)]/50
				hover:bg-[var(--vscode-list-hoverBackground)]/80 hover:border-aihydro-ocean-blue/30
				card-hover-lift
				transition-all duration-200 ease-out"
			onClick={() => onExecute()}>
			{/* Icon with colored background */}
			<div className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg ${bg} mr-3`}>
				<Icon size={20} style={{ color }} />
			</div>

			{/* Text content */}
			<div className="flex-grow min-w-0 mr-2">
				<h3 className="text-sm font-medium truncate text-[var(--vscode-editor-foreground)] leading-tight m-0">
					{task.title}
				</h3>
				<p className="text-xs truncate text-[var(--vscode-descriptionForeground)] leading-tight mt-0.5 m-0">
					{task.description}
				</p>
			</div>

			{/* Arrow indicator */}
			<div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
				<ChevronRight className="text-[var(--vscode-descriptionForeground)]" size={16} />
			</div>
		</div>
	)
}

export default QuickWinCard
