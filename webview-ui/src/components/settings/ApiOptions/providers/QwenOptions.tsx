import { VSCodeTextField, VSCodeLink, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import DropdownContainer from "../DropdownContainer"

const QwenOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="qwen-line-provider">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Alibaba API Line</span>
				</label>
				<VSCodeDropdown
					id="qwen-line-provider"
					value={apiConfiguration?.qwenApiLine || "china"}
					onChange={handleInputChange("qwenApiLine")}
					style={{
						minWidth: 130,
						position: "relative",
					}}>
					<VSCodeOption value="china">China API</VSCodeOption>
					<VSCodeOption value="international">International API</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Please select the appropriate API interface based on your location. If you are in China, choose the China API
				interface. Otherwise, choose the International API interface.
			</p>
			<VSCodeTextField
				value={apiConfiguration?.qwenApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("qwenApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>Qwen API Key</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
				{!apiConfiguration?.qwenApiKey && (
					<VSCodeLink
						href="https://bailian.console.aliyun.com/"
						style={{
							display: "inline",
							fontSize: "inherit",
						}}>
						You can get a Qwen API key by signing up here.
					</VSCodeLink>
				)}
			</p>
		</div>
	)
}

export default QwenOptions
