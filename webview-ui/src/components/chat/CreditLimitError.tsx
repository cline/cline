import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { vscode } from "../../utils/vscode"

interface CreditLimitErrorProps {
	creditsRemaining: number
	creditsUsed: number
	rechargeUrl: string
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({ creditsRemaining, creditsUsed, rechargeUrl }) => {
	return (
		<div
			role="alert"
			style={{
				backgroundColor: "var(--vscode-errorBackground)",
				padding: "12px",
				borderRadius: "3px",
				marginBottom: "10px",
				border: "1px solid var(--vscode-errorBorder)",
			}}>
			<div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
				<i
					className="codicon codicon-error"
					style={{ color: "var(--vscode-errorForeground)", marginRight: "8px" }}
					aria-hidden="true"
				/>
				<span style={{ fontWeight: "bold", color: "var(--vscode-errorForeground)" }}>Credit Limit Reached</span>
			</div>
			<div style={{ marginBottom: "12px", color: "var(--vscode-foreground)" }}>
				<div style={{ marginBottom: "4px" }}>Credits Remaining: {creditsRemaining.toLocaleString()}</div>
				<div>Credits Used: {creditsUsed.toLocaleString()}</div>
			</div>
			<div style={{ display: "flex", gap: "8px" }}>
				<VSCodeButton appearance="primary" onClick={() => window.open(rechargeUrl, "_blank")}>
					Add Credits
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={() => vscode.postMessage({ type: "clearTask" })}>
					Start New Task
				</VSCodeButton>
			</div>
		</div>
	)
}

export default CreditLimitError
