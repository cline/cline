import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ClineAuthStatus } from "@/components/account/ClineAuthStatus"
import { useClineSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoVariable from "../../assets/ClineLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<ClineLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<ClineLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				使用 Cline 注册
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			<ClineAuthStatus message={authStatusMessage} />

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				继续即表示您同意 <VSCodeLink href="https://cline.bot/tos">服务条款</VSCodeLink> 和{" "}
				<VSCodeLink href="https://cline.bot/privacy">隐私政策。</VSCodeLink>
			</p>
		</div>
	)
}
