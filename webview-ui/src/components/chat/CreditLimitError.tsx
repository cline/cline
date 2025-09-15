import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useClineAuth } from "@/context/ClineAuthContext"
import { AccountServiceClient, TaskServiceClient } from "@/services/grpc-client"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	// buyCreditsUrl?: string
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	message = "You have run out of credits.",
	// buyCreditsUrl = "https://app.cline.bot/dashboard/account?tab=credits&redirect=true",
}) => {
	const { activeOrganization } = useClineAuth()
	const [fullBuyCreditsUrl, setFullBuyCreditsUrl] = useState<string>("")

	const isPersonal = !activeOrganization?.organizationId
	const buyCreditsUrl = isPersonal
		? "https://app.cline.bot/dashboard/account?tab=credits&redirect=true"
		: "https://app.cline.bot/dashboard/organization?tab=credits&redirect=true"

	useEffect(() => {
		const fetchCallbackUrl = async () => {
			try {
				const callbackUrl = (await AccountServiceClient.getRedirectUrl({})).value
				const url = new URL(buyCreditsUrl)
				url.searchParams.set("callback_url", callbackUrl)
				setFullBuyCreditsUrl(url.toString())
			} catch (error) {
				console.error("Error fetching callback URL:", error)
				// Fallback to URL without callback if the API call fails
				setFullBuyCreditsUrl(buyCreditsUrl)
			}
		}
		fetchCallbackUrl()
	}, [buyCreditsUrl])

	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-[var(--vscode-textBlockQuote-background)]">
			<div className="mb-3 font-azeret-mono">
				<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "8px" }}>{message}</div>
				{/* <div style={{ marginBottom: "12px" }}>
					<div style={{ color: "var(--vscode-foreground)" }}>
						Current Balance: <span style={{ fontWeight: "bold" }}>{currentBalance.toFixed(2)}</span>
					</div>
					<div style={{ color: "var(--vscode-foreground)" }}>Total Spent: {totalSpent.toFixed(2)}</div>
					<div style={{ color: "var(--vscode-foreground)" }}>Total Promotions: {totalPromotions.toFixed(2)}</div>
				</div> */}
			</div>

			<VSCodeButtonLink
				href={fullBuyCreditsUrl}
				style={{
					width: "100%",
					marginBottom: "8px",
				}}>
				<span className="codicon codicon-credit-card mr-[6px] text-[14px]" />
				Buy Credits
			</VSCodeButtonLink>

			<VSCodeButton
				appearance="secondary"
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
