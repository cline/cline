import React from "react"

interface TypingIndicatorProps {
	visible?: boolean
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ visible = true }) => {
	if (!visible) {
		return null
	}

	return (
		<div className="flex items-center gap-2 px-4 py-2 my-1">
			<div className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--ai-hydro-ocean-blue)]">
				<span className="codicon codicon-robot text-white text-xs" />
			</div>
			<div className="flex items-center gap-1">
				<div className="typing-dot w-1.5 h-1.5 rounded-full bg-[var(--vscode-descriptionForeground)] animate-typing-dot" />
				<div className="typing-dot w-1.5 h-1.5 rounded-full bg-[var(--vscode-descriptionForeground)] animate-typing-dot-delay-1" />
				<div className="typing-dot w-1.5 h-1.5 rounded-full bg-[var(--vscode-descriptionForeground)] animate-typing-dot-delay-2" />
			</div>
			<span className="text-xs text-[var(--vscode-descriptionForeground)] ml-1">AI Hydro is thinking...</span>
		</div>
	)
}

TypingIndicator.displayName = "TypingIndicator"

export default TypingIndicator
