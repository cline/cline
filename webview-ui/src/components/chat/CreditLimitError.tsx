import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { TaskServiceClient } from "@/services/grpc-client"
import { AskResponseRequest } from "@shared/proto/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { clineEnvConfig } from "@/config"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	buyCreditsUrl?: string
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	currentBalance = 0,
	totalSpent = 0,
	totalPromotions = 0,
	message = "You have run out of credit.",
	buyCreditsUrl = `${clineEnvConfig.appBaseUrl}/dashboard`,
}) => {
	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-[var(--vscode-textBlockQuote-background)]">
			<div className="mb-3 font-azeret-mono">
				<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "8px" }}>{message}</div>
				<div style={{ marginBottom: "12px" }}>
					<div style={{ color: "var(--vscode-foreground)" }}>
						Current Balance: <span style={{ fontWeight: "bold" }}>{currentBalance.toFixed(2)}</span>
					</div>
					<div style={{ color: "var(--vscode-foreground)" }}>Total Spent: {totalSpent.toFixed(2)}</div>
					<div style={{ color: "var(--vscode-foreground)" }}>Total Promotions: {totalPromotions.toFixed(2)}</div>
				</div>
			</div>

			<VSCodeButtonLink
				href={buyCreditsUrl}
				style={{
					width: "100%",
					marginBottom: "8px",
				}}>
				<span className="codicon codicon-credit-card mr-[6px] text-[14px]" />
				Buy Credits
			</VSCodeButtonLink>

			<VSCodeButton
				onClick={async () => {
					try {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: "",
								images: [],
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
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
