import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { getOpenRouterAuthUrl } from "@/utils/providers"
import VSCodeButtonLink from "../../../common/VSCodeButtonLink"

const OpenRouterOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, uriScheme } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.openRouterApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("openRouterApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
			</VSCodeTextField>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ margin: "5px 0 0 0" }} appearance="secondary">
					Get OpenRouter API Key
				</VSCodeButtonLink>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
			</p>
		</div>
	)
}

export default OpenRouterOptions
