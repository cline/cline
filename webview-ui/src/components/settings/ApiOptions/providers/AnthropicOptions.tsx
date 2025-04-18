import { VSCodeCheckbox, VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const AnthropicOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.apiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("apiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Anthropic API Key</span>
			</VSCodeTextField>

			<VSCodeCheckbox
				checked={anthropicBaseUrlSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setAnthropicBaseUrlSelected(isChecked)
					if (!isChecked) {
						setApiConfiguration({
							...apiConfiguration,
							anthropicBaseUrl: "",
						})
					}
				}}>
				Use custom base URL
			</VSCodeCheckbox>

			{anthropicBaseUrlSelected && (
				<VSCodeTextField
					value={apiConfiguration?.anthropicBaseUrl || ""}
					style={{ width: "100%", marginTop: 3 }}
					type="url"
					onInput={handleInputChange("anthropicBaseUrl")}
					placeholder="Default: https://api.anthropic.com"
				/>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.apiKey && (
					<VSCodeLink
						href="https://console.anthropic.com/settings/keys"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get an Anthropic API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default AnthropicOptions
