import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, Dispatch, SetStateAction } from "react"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { AccountServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import ApiOptionsSection from "./ApiOptionsSection"

interface WelcomeViewProps {
	showApiOptions: boolean
	setShowApiOptions: Dispatch<SetStateAction<boolean>>
}

const WelcomeView = memo(({ showApiOptions, setShowApiOptions }: WelcomeViewProps) => {
	const handleLogin = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto">
				<h2>Hi, I'm Cline</h2>
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in{" "}
					<VSCodeLink href="https://www.anthropic.com/claude/sonnet" className="inline">
						Claude 3.7 Sonnet's
					</VSCodeLink>
					agentic coding capabilities and access to tools that let me create & edit files, explore complex projects, use
					a browser, and execute terminal commands <i>(with your permission, of course)</i>. I can even use MCP to
					create new tools and extend my own capabilities.
				</p>

				<p className="text-[var(--vscode-descriptionForeground)]">
					Sign up for an account to get started for free, or use an API key that provides access to models like Claude
					3.7 Sonnet.
				</p>

				<VSCodeButton appearance="primary" onClick={handleLogin} className="w-full mt-1">
					Get Started for Free
				</VSCodeButton>

				{!showApiOptions && (
					<VSCodeButton
						appearance="secondary"
						onClick={() => setShowApiOptions(!showApiOptions)}
						className="mt-2.5 w-full">
						Use your own API key
					</VSCodeButton>
				)}

				<ApiOptionsSection showApiOptions={showApiOptions} />
			</div>
		</div>
	)
})

export default WelcomeView
