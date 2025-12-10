import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ClineAuthStatus } from "../account/ClineAuthStatus"

export const ClineAccountInfoCard = () => {
	const { clineUser } = useClineAuth()
	const { navigateToAccount } = useExtensionState()

	const user = clineUser || undefined

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
				<div>
					<ClineAuthStatus authButtonText="Sign Up with Cline" />
				</div>
			)}
		</div>
	)
}
