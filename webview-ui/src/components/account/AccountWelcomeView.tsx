import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ClineLogoVariable from "../../assets/BeadsmithLogoVariable"

export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()

	return (
		<div className="flex flex-col items-center pr-3 gap-2.5">
			<ClineLogoVariable className="size-16 mb-4" environment={environment} />

			<p className="text-center">
				Beadsmith integrates with your existing AI providers. Configure your preferred provider in Settings to get started.
			</p>

			<div className="text-sm text-center">
				<p className="mb-2">Supported providers include:</p>
				<ul className="list-none p-0 m-0 space-y-1">
					<li>Claude Code (Anthropic)</li>
					<li>GitHub Copilot</li>
					<li>OpenAI Codex (ChatGPT Plus/Pro)</li>
					<li>OpenRouter, Anthropic, Google Gemini</li>
					<li>And many more...</li>
				</ul>
			</div>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0 mt-4">
				Beadsmith is a fork of{" "}
				<VSCodeLink href="https://github.com/cline/cline">Cline</VSCodeLink>.
			</p>
		</div>
	)
}
