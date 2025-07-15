import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { TaskServiceClient } from "@/services/grpc-client"
import { AskResponseRequest } from "@shared/proto/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"

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
	buyCreditsUrl = "https://app.cline.bot/dashboard",
}) => {
	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-[var(--vscode-textBlockQuote-background)]">
			<div className="mb-2">{message}</div>
			<div className="mb-3">
				<div className="text-[var(--vscode-foreground)]">
					Current Balance: <span className="font-bold">${currentBalance.toFixed(4)}</span>
				</div>
			</div>

			<VSCodeButtonLink
				href={buyCreditsUrl}
				style={{
					width: "100%",
					marginBottom: "8px",
				}}>
				<span className="codicon codicon-credit-card mr-0.5 text-sm" />
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
