import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

export const ClineAccountInfoCard = () => {
	const { clineUser } = useClineAuth()
	const { navigateToAccount } = useExtensionState()
	const { t } = useTranslation("common")

	const user = clineUser || undefined

	const handleLogin = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					{t("settings.about.account.view_billing_usage")}
				</VSCodeButton>
			) : (
				<div>
					<VSCodeButton className="mt-0" onClick={handleLogin}>
						{t("settings.about.account.sign_up_with_cline")}
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}
