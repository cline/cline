import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useFirebaseAuth } from "../../context/FirebaseAuthContext"
import { vscode } from "../../utils/vscode"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import clineLogoWhite from "../../assets/cline-logo-white.svg"
import CountUp from "react-countup"

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className="text-[var(--vscode-foreground)] m-0">Cline Account</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div className="flex-grow overflow-y-scroll pr-[8px] flex flex-col">
				<div className="mb-[5px]">
					<ClineAccountView />
				</div>
			</div>
		</div>
	)
}

export const ClineAccountView = () => {
	const { user, handleSignOut } = useFirebaseAuth()
	const amount = 38.06

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
		<div className="max-w-[400px]">
			{user ? (
				<div className="flex flex-col p-[20px]">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6">
							{user.photoURL ? (
								<img src={user.photoURL} alt="Profile" className="size-16 rounded-full mr-[16px]" />
							) : (
								<div className="w-[64px] h-[64px] rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-[24px] text-[var(--vscode-button-foreground)] mr-[16px]">
									{user.displayName?.[0] || user.email?.[0] || "?"}
								</div>
							)}

							<div className="flex flex-col">
								{user.displayName && (
									<h2 className="text-[var(--vscode-foreground)] m-0 mb-[5px] text-[24px] font-normal">
										{user.displayName}
									</h2>
								)}

								{user.email && (
									<div className="text-[16px] text-[var(--vscode-descriptionForeground)]">{user.email}</div>
								)}
							</div>
						</div>
					</div>

					<div className="flex gap-2">
						<VSCodeButtonLink href="https://app.cline.bot/account" appearance="primary" className="w-24">
							Account
						</VSCodeButtonLink>
						<VSCodeButton appearance="secondary" onClick={handleLogout} className="w-24">
							Log out
						</VSCodeButton>
					</div>

					<div className="my-2.5 mt-7 w-full">
						<VSCodeDivider />
					</div>

					<div className="w-full flex flex-col items-center mt-[10px]">
						<div className="text-[14px] text-[var(--vscode-descriptionForeground)] mb-[10px]">CURRENT BALANCE</div>

						<div className="text-[36px] font-bold text-[var(--vscode-foreground)] mb-[20px] flex">
							<span>$</span>
							<CountUp end={amount} duration={0.66} decimals={2} />
						</div>

						<VSCodeButtonLink href="https://app.cline.bot/credits/#buy" className="w-full mb-[10px]">
							Add Credits
						</VSCodeButtonLink>
					</div>

					<div className="my-[10px] w-full">
						<VSCodeDivider />
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center p-[20px] max-w-[400px]">
					<img src={clineLogoWhite} alt="Cline Logo" className="w-[60px] h-[60px] mb-[15px]" />

					<h2 className="text-[var(--vscode-foreground)] m-0 mb-[20px] text-[24px] font-normal">Sign up with Cline</h2>

					<VSCodeButton onClick={handleLogin} className="w-full mb-[20px]">
						Login with Cline
					</VSCodeButton>

					<p className="text-[var(--vscode-descriptionForeground)] text-[12px] text-center m-0">
						By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
						<VSCodeLink href="https://cline.bot/privacy">Privacy Policy</VSCodeLink>.
					</p>
				</div>
			)}
		</div>
	)
}

export default memo(AccountView)
