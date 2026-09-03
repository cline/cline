import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AccountServiceClient } from "@/services/grpc-client"

const ORG_CLINE_PASS_RESTRICTION_MESSAGE = "Organization accounts cannot use ClinePass subscriptions."

const OrgClinePassRestrictionError = () => {
	const { t } = useTranslation()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToPersonalAccount = async () => {
		setIsSwitching(true)
		setError(undefined)
		try {
			await AccountServiceClient.setUserOrganization({})
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to personal Cline account:", error)
			setError(t("chat:errors.orgRestriction.switchFailed"))
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="org-cline-pass-restriction-error">
			<div className="text-error mb-2">{t("chat:errors.orgRestriction.title")}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{t("chat:errors.orgRestriction.body")}
			</div>
			<VSCodeButton className="w-full mt-3" disabled={isSwitching || didSwitch} onClick={handleSwitchToPersonalAccount}>
				{isSwitching
					? t("chat:errors.billing.switching")
					: didSwitch
						? t("chat:errors.orgRestriction.switchedToPersonal")
						: t("chat:errors.orgRestriction.switchToPersonal")}
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
					{t("chat:errors.billing.retryAfterSwitching")}
				</div>
			)}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export { ORG_CLINE_PASS_RESTRICTION_MESSAGE }
export default OrgClinePassRestrictionError
