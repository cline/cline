import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { ClineAuthStatus } from "@/components/account/ClineAuthStatus"
import { useClineAuth, useClineSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const ClineAccountInfoCard = () => {
	const { clineUser } = useClineAuth()
	const { navigateToAccount } = useExtensionState()
	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()
	const [didStartLogin, setDidStartLogin] = useState(false)

	const user = clineUser || undefined

	const handleLogin = () => {
		setDidStartLogin(true)
		handleSignIn()
	}

	useEffect(() => {
		if (didStartLogin && user) {
			navigateToAccount()
		}
	}, [didStartLogin, navigateToAccount, user])

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				<div className="flex flex-col gap-3">
					<VSCodeButton className="mt-0" disabled={isLoginLoading} onClick={handleLogin}>
						Sign Up with Cline
						{isLoginLoading && (
							<span className="ml-1 animate-spin">
								<span className="codicon codicon-refresh" />
							</span>
						)}
					</VSCodeButton>
					<ClineAuthStatus message={authStatusMessage} />
				</div>
			)}
		</div>
	)
}
