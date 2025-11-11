import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { StyledCreditDisplay } from "./StyledCreditDisplay"

type CreditBalanceProps = {
	balance: number | null
	fetchCreditBalance: () => void
	creditUrl: URL
	lastFetchTime: number
	isLoading: boolean
}

export const CreditBalance = ({ balance, fetchCreditBalance, creditUrl, lastFetchTime, isLoading }: CreditBalanceProps) => {
	const { t } = useTranslation("common")

	return (
		<div
			className="w-full flex flex-col items-center"
			title={`${t("account.credit.last_updated")}: ${new Date(lastFetchTime).toLocaleTimeString()}`}>
			<div className="text-sm text-(--vscode-descriptionForeground) mb-3 font-azeret-mono font-light">
				{t("account.credit.current_balance")}
			</div>

			<div className="font-bold text-2xl mb-6 flex items-center gap-2">
				{balance === null ? <span>----</span> : <StyledCreditDisplay balance={balance} />}
				<VSCodeButton
					appearance="icon"
					className={`mt-1 ${isLoading ? "animate-spin" : ""}`}
					disabled={isLoading}
					onClick={fetchCreditBalance}>
					<span className="codicon codicon-refresh"></span>
				</VSCodeButton>
			</div>

			<div className="w-full">
				<VSCodeButtonLink className="w-full" href={creditUrl.href}>
					{t("account.credit.add_credits")}
				</VSCodeButtonLink>
			</div>
		</div>
	)
}
