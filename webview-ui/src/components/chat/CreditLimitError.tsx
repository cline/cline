import React from "react"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"
import { Invoke } from "../../../../src/shared/ExtensionMessage"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent: number
	totalPromotions: number
	message: string
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({ currentBalance, totalSpent, totalPromotions, message }) => {
	return (
		<div
			style={{
				backgroundColor: "var(--vscode-textBlockQuote-background)",
				padding: "12px",
				borderRadius: "4px",
				marginBottom: "12px",
			}}>
			<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "8px" }}>{message}</div>
			<div style={{ marginBottom: "12px" }}>
				<div style={{ color: "var(--vscode-foreground)" }}>
					Current Balance: <span style={{ fontWeight: "bold" }}>${currentBalance.toFixed(2)}</span>
				</div>
				<div style={{ color: "var(--vscode-foreground)" }}>Total Spent: ${totalSpent.toFixed(2)}</div>
				<div style={{ color: "var(--vscode-foreground)" }}>Total Promotions: ${totalPromotions.toFixed(2)}</div>
			</div>

			<VSCodeButtonLink
				href="https://app.cline.bot/credits"
				style={{
					width: "100%",
					marginBottom: "8px",
				}}>
				<span className="codicon codicon-credit-card" style={{ fontSize: "14px", marginRight: "6px" }} />
				Buy Credits
			</VSCodeButtonLink>

			<VSCodeButton
				onClick={() => {
					vscode.postMessage({
						type: "invoke",
						text: "primaryButtonClick" satisfies Invoke,
					})
				}}
				appearance="secondary"
				style={{
					width: "100%",
				}}>
				<span className="codicon codicon-refresh" style={{ fontSize: "14px", marginRight: "6px" }} />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default CreditLimitError
