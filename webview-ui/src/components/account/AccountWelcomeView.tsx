import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoVariable from "../../assets/ClineLogoVariable"
import { ClineAuthStatus } from "./ClineAuthStatus"

export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { hasSessionData } = useClineAuth()

	if (!hasSessionData) {
		return (
			<div className="flex flex-col items-center pr-3 gap-2.5">
				<ClineLogoVariable className="size-16 mb-4" environment={environment} />

				<p>
					Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and
					more upcoming features.
				</p>

				<ClineAuthStatus authButtonText="Sign up with Cline" />

				<p className="text-description text-xs text-center m-0">
					By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
					<VSCodeLink href="https://cline.bot/privacy">Privacy Policy.</VSCodeLink>
				</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col items-center pr-3 gap-2.5">
			<ClineLogoVariable className="size-16 mb-4" environment={environment} />

			<ClineAuthStatus authButtonText="Sign up with Cline" />
		</div>
	)
}
