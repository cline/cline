import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useMemo, useState } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { useClineAuth } from "@/context/ClineAuthContext"
import { AccountServiceClient, TaskServiceClient } from "@/services/grpc-client"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	buyCreditsUrl?: string
}

const DEFAULT_BUY_CREDITS_URL = {
	USER: "https://app.cline.bot/dashboard/account?tab=credits&redirect=true",
	ORG: "https://app.cline.bot/dashboard/organization?tab=credits&redirect=true",
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	message = "You have run out of credits.",
	buyCreditsUrl,
	currentBalance,
	totalPromotions,
	totalSpent,
}) => {
	const { activeOrganization } = useClineAuth()
	const [fullBuyCreditsUrl, setFullBuyCreditsUrl] = useState<string>("")

	const dashboardUrl = useMemo(() => {
		return buyCreditsUrl ?? (activeOrganization?.organizationId ? DEFAULT_BUY_CREDITS_URL.ORG : DEFAULT_BUY_CREDITS_URL.USER)
	}, [buyCreditsUrl, activeOrganization?.organizationId])

	useEffect(() => {
		const fetchCallbackUrl = async () => {
			try {
				const callbackUrl = (await AccountServiceClient.getRedirectUrl({})).value
				const url = new URL(dashboardUrl)
				url.searchParams.set("callback_url", callbackUrl)
				setFullBuyCreditsUrl(url.toString())
			} catch (error) {
				console.error("Error fetching callback URL:", error)
				// Fallback to URL without callback if the API call fails
				setFullBuyCreditsUrl(dashboardUrl)
			}
		}
		fetchCallbackUrl()
	}, [dashboardUrl])

	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)">
			<div className="mb-3 font-azeret-mono">
				<div className="text-error mb-2">{message}</div>
				<div className="mb-3">
					{currentBalance ? (
						<div className="text-foreground">
							Current Balance: <span className="font-bold">{currentBalance.toFixed(2)}</span>
						</div>
					) : null}
					{totalSpent ? <div className="text-foreground">Total Spent: {totalSpent.toFixed(2)}</div> : null}
					{totalPromotions ? (
						<div className="text-foreground">Total Promotions: {totalPromotions.toFixed(2)}</div>
					) : null}
				</div>
			</div>

			<VSCodeButtonLink className="w-full mb-2" href={fullBuyCreditsUrl}>
				<span className="codicon codicon-credit-card mr-[6px] text-[14px]" />
				Buy Credits
			</VSCodeButtonLink>

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				onClick={async () => {
					try {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default CreditLimitError
