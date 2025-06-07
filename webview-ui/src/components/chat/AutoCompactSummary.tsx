import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"
import { WithCopyButton } from "./ChatRow"

interface AutoCompactSummaryProps {
	summary: string
}

const AutoCompactSummary: React.FC<AutoCompactSummaryProps> = ({ summary }) => {
	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "10px",
					marginBottom: "12px",
				}}>
				<span
					className="codicon codicon-history"
					style={{
						color: "var(--vscode-foreground)",
						marginBottom: "-1.5px",
					}}></span>
				<span style={{ color: "var(--vscode-foreground)", fontWeight: "bold" }}>Conversation Summary</span>
			</div>
			<WithCopyButton textToCopy={summary}>
				<MarkdownBlock markdown={summary} />
			</WithCopyButton>
		</div>
	)
}

export default AutoCompactSummary
