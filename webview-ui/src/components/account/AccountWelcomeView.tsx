import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { handleSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoVariable from "../../assets/ClineLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<ClineLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()

	return (
		<div className="flex flex-col items-center pr-3 gap-2.5">
			<ClineLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" onClick={() => handleSignIn()}>
				Sign up with Cline
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
				<VSCodeLink href="https://cline.bot/privacy">Privacy Policy.</VSCodeLink>
			</p>
		</div>
	)
}
