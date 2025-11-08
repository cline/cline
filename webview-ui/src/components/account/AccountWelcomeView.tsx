import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { handleSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoVariable from "../../assets/ClineLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<ClineLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { t } = useTranslation("common")

	return (
		<div className="flex flex-col items-center pr-3 gap-2.5">
			<ClineLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				{t(
					"account.welcome.description",
					"Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more upcoming features.",
				)}
			</p>

			<VSCodeButton className="w-full mb-4" onClick={() => handleSignIn()}>
				{t("account.welcome.sign_up", "Sign up with Cline")}
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				{t("account.welcome.agreement_prefix", "By continuing, you agree to the")}{" "}
				<VSCodeLink href="https://cline.bot/tos">{t("account.welcome.terms_of_service", "Terms of Service")}</VSCodeLink>{" "}
				{t("account.welcome.and", "and")}{" "}
				<VSCodeLink href="https://cline.bot/privacy">{t("account.welcome.privacy_policy", "Privacy Policy")}</VSCodeLink>.
			</p>
		</div>
	)
}
