import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useClineAuth } from "@/context/ClineAuthContext"

const ORG_CLINE_PASS_RESTRICTION_MESSAGE = "Organization accounts cannot use ClinePass subscriptions."

const OrgClinePassRestrictionError = () => {
	const { accountSwitch, switchOrganization } = useClineAuth()
	const isSwitching = !!accountSwitch
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToPersonalAccount = async () => {
		setError(undefined)
		try {
			if (!(await switchOrganization())) throw new Error("Account switch not confirmed")
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to personal Cline account:", error)
			setError("Failed to switch account. Use /accounts to switch to your personal account.")
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="org-cline-pass-restriction-error">
			<div className="text-error mb-2">Organization account cannot use ClinePass</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{ORG_CLINE_PASS_RESTRICTION_MESSAGE}
			</div>
			<VSCodeButton className="w-full mt-3" disabled={isSwitching || didSwitch} onClick={handleSwitchToPersonalAccount}>
				{isSwitching ? "Switching..." : didSwitch ? "Switched to personal account" : "Switch to personal account"}
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Retry the request after switching.</div>
			)}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export { ORG_CLINE_PASS_RESTRICTION_MESSAGE }
export default OrgClinePassRestrictionError
