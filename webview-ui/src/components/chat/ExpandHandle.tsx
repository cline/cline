import { memo } from "react"

interface ExpandHandleProps {
	isExpanded: boolean
	onToggle: () => void
	backgroundColor?: string
}

/**
 * Reusable expand/collapse handle component
 * Used by CompletionOutput, PlanCompletionOutput, CommandOutput, etc.
 */
const ExpandHandle = memo(({ isExpanded, onToggle, backgroundColor = "var(--vscode-editorGroup-border)" }: ExpandHandleProps) => {
	return (
		<div
			onClick={onToggle}
			style={{
				position: "absolute",
				bottom: "-8px",
				left: "50%",
				transform: "translateX(-50%)",
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				padding: "1px 14px",
				cursor: "pointer",
				backgroundColor,
				borderRadius: "2px",
				border: "none",
			}}>
			<span
				className={`codicon codicon-triangle-${isExpanded ? "up" : "down"}`}
				style={{
					fontSize: "11px",
					color: "#000000",
				}}
			/>
		</div>
	)
})

export default ExpandHandle
