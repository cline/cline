import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
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
	return (
		<div
			className="w-full flex flex-col items-center"
			title={`Last updated: ${new Date(lastFetchTime).toLocaleTimeString()}`}>
			<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3 font-azeret-mono font-light">
				CURRENT BALANCE
			</div>

			<div className="text-4xl font-bold text-[var(--vscode-foreground)] mb-6 flex items-center gap-2">
				{balance === null ? <span>----</span> : <StyledCreditDisplay balance={balance} />}
				<VSCodeButton
					appearance="icon"
					className={`mt-1 ${isLoading ? "animate-spin" : ""}`}
					onClick={fetchCreditBalance}
					disabled={isLoading}>
					<span className="codicon codicon-refresh"></span>
				</VSCodeButton>
			</div>

			<div className="w-full">
				<VSCodeButtonLink href={creditUrl.href} className="w-full">
					Add Credits
				</VSCodeButtonLink>
			</div>
		</div>
	)
}
