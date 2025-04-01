import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { useFirebaseAuth } from "../../context/FirebaseAuthContext"
import { vscode } from "../../utils/vscode"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import ClineLogoWhite from "../../assets/ClineLogoWhite"
import CountUp from "react-countup"
import CreditsHistoryTable from "./CreditsHistoryTable"
import { UsageTransaction, PaymentTransaction } from "../../../../src/shared/ClineAccount"

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className="text-[var(--vscode-foreground)] m-0">Account</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div className="flex-grow overflow-hidden pr-[8px] flex flex-col">
				<div className="h-full mb-[5px]">
					<ClineAccountView />
				</div>
			</div>
		</div>
	)
}

export const ClineAccountView = () => {
	const { user, handleSignOut } = useFirebaseAuth()
	const [balance, setBalance] = useState(0)
	const [isLoading, setIsLoading] = useState(true)
	const [usageData, setUsageData] = useState<UsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])

	// Listen for balance and transaction data updates from the extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "userCreditsBalance" && message.userCreditsBalance) {
				setBalance(message.userCreditsBalance.currentBalance)
			} else if (message.type === "userCreditsUsage" && message.userCreditsUsage) {
				setUsageData(message.userCreditsUsage.usageTransactions)
			} else if (message.type === "userCreditsPayments" && message.userCreditsPayments) {
				setPaymentsData(message.userCreditsPayments.paymentTransactions)
			}
			setIsLoading(false)
		}

		window.addEventListener("message", handleMessage)

		// Fetch all account data when component mounts
		if (user) {
			setIsLoading(true)
			vscode.postMessage({ type: "fetchUserCreditsData" })
		}

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [user])

	const handleLogin = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	const handleLogout = () => {
		// First notify extension to clear API keys and state
		vscode.postMessage({ type: "accountLogoutClicked" })
		// Then sign out of Firebase
		handleSignOut()
	}
	return (
		<div className="h-full flex flex-col">
			{user ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6 flex-wrap gap-y-4">
							{user.photoURL ? (
								<img src={user.photoURL} alt="Profile" className="size-16 rounded-full mr-4" />
							) : (
								<div className="size-16 rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-2xl text-[var(--vscode-button-foreground)] mr-4">
									{user.displayName?.[0] || user.email?.[0] || "?"}
								</div>
							)}

							<div className="flex flex-col">
								{user.displayName && (
									<h2 className="text-[var(--vscode-foreground)] m-0 mb-1 text-lg font-medium">
										{user.displayName}
									</h2>
								)}

								{user.email && (
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">{user.email}</div>
								)}
							</div>
						</div>
					</div>

					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink href="https://app.cline.bot/credits" appearance="primary" className="w-full">
								Dashboard
							</VSCodeButtonLink>
						</div>
						<VSCodeButton appearance="secondary" onClick={handleLogout} className="w-full min-[225px]:w-1/2">
							Log out
						</VSCodeButton>
					</div>

					<VSCodeDivider className="w-full my-6" />

					<div className="w-full flex flex-col items-center">
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3">CURRENT BALANCE</div>

						<div className="text-4xl font-bold text-[var(--vscode-foreground)] mb-6 flex items-center gap-2">
							{isLoading ? (
								<div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
							) : (
								<>
									<span>$</span>
									<CountUp end={balance} duration={0.66} decimals={2} />
									<VSCodeButton
										appearance="icon"
										className="mt-1"
										onClick={() => vscode.postMessage({ type: "fetchUserCreditsData" })}>
										<span className="codicon codicon-refresh"></span>
									</VSCodeButton>
								</>
							)}
						</div>

						<div className="w-full">
							<VSCodeButtonLink href="https://app.cline.bot/credits/#buy" className="w-full">
								Add Credits
							</VSCodeButtonLink>
						</div>
					</div>

					<VSCodeDivider className="mt-6 mb-3 w-full" />

					<div className="flex-grow flex flex-col min-h-0 pb-[0px]">
						<CreditsHistoryTable isLoading={isLoading} usageData={usageData} paymentsData={paymentsData} />
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center pr-3">
					<ClineLogoWhite className="size-16 mb-4" />

					<p style={{}}>
						Sign up for an account to get access to the latest models, billing dashboard to view usage and credits,
						and more upcoming features.
					</p>

					<VSCodeButton onClick={handleLogin} className="w-full mb-4">
						Sign up with Cline
					</VSCodeButton>

					<p className="text-[var(--vscode-descriptionForeground)] text-xs text-center m-0">
						By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
						<VSCodeLink href="https://cline.bot/privacy">Privacy Policy.</VSCodeLink>
					</p>
				</div>
			)}
		</div>
	)
}

export default memo(AccountView)
