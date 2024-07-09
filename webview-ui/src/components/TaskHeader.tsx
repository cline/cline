import React, { useState } from "react"
import TextTruncate from "react-text-truncate"

interface TaskHeaderProps {
	taskText: string
	tokensIn: number
	tokensOut: number
	totalCost: number
}

const TaskHeader: React.FC<TaskHeaderProps> = ({ taskText, tokensIn, tokensOut, totalCost }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const toggleExpand = () => setIsExpanded(!isExpanded)

	return (
		<div
			style={{
				padding: "15px 15px 10px 15px",
			}}>
			<div
				style={{
					backgroundColor: "var(--vscode-badge-background)",
					color: "var(--vscode-badge-foreground)",
					borderRadius: "3px",
					padding: "8px",
					display: "flex",
					flexDirection: "column",
					gap: "8px",
				}}>
				<div style={{ fontSize: "var(--vscode-font-size)", lineHeight: "1.5" }}>
					<TextTruncate
						line={isExpanded ? 0 : 3}
						element="span"
						truncateText="…"
						text={taskText}
						textTruncateChild={
							<span
								style={{
									cursor: "pointer",
									color: "var(--vscode-textLink-foreground)",
									marginLeft: "5px",
								}}
								onClick={toggleExpand}>
								See more
							</span>
						}
					/>
					{isExpanded && (
						<span
							style={{
								cursor: "pointer",
								color: "var(--vscode-textLink-foreground)",
								marginLeft: "5px",
							}}
							onClick={toggleExpand}>
							See less
						</span>
					)}
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span style={{ fontWeight: "bold" }}>Tokens:</span>
						<div style={{ display: "flex", gap: "8px" }}>
							<span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<i className="codicon codicon-arrow-down" style={{ fontSize: "12px", marginBottom: "-1px" }} />
								{tokensIn.toLocaleString()}
							</span>
							<span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<i className="codicon codicon-arrow-up" style={{ fontSize: "12px", marginBottom: "-1px" }} />
								{tokensOut.toLocaleString()}
							</span>
						</div>
					</div>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span style={{ fontWeight: "bold" }}>API Cost:</span>
						<span>${totalCost.toFixed(4)}</span>
					</div>
				</div>
			</div>
		</div>
	)
}

export default TaskHeader
