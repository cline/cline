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
			<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "8px" }}>积分余额不足</div>
			<div style={{ marginBottom: "12px" }}>
				<div style={{ color: "var(--vscode-foreground)" }}>
					当前余额: <span style={{ fontWeight: "bold" }}>${currentBalance.toFixed(2)}</span>
				</div>
				<div style={{ color: "var(--vscode-foreground)" }}>总消费: ${totalSpent.toFixed(2)}</div>
				<div style={{ color: "var(--vscode-foreground)" }}>总优惠: ${totalPromotions.toFixed(2)}</div>
			</div>

			<VSCodeButtonLink
				href="https://app.cline.bot/credits/#buy"
				style={{
					width: "100%",
					marginBottom: "8px",
				}}>
				<span className="codicon codicon-credit-card" style={{ fontSize: "14px", marginRight: "6px" }} />
				购买积分
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
				重试请求
			</VSCodeButton>
		</div>
	)
}

export default CreditLimitError
