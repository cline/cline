import { VSCodeTextField, VSCodeLink, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import ThinkingBudgetSlider from "../model/ThinkingBudgetSlider"

const LiteLLMOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("liteLlmApiKey")}
				placeholder="Default: noop">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmBaseUrl || ""}
				style={{ width: "100%", marginTop: 10 }}
				type="url"
				onInput={handleInputChange("liteLlmBaseUrl")}
				placeholder={"Default: http://localhost:4000"}>
				<span style={{ fontWeight: 500 }}>Base URL (optional)</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.liteLlmModelId || ""}
				style={{ width: "100%", marginTop: 10 }}
				onInput={handleInputChange("liteLlmModelId")}
				placeholder={"e.g. gpt-4"}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>

			<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
				<VSCodeCheckbox
					checked={apiConfiguration?.liteLlmUsePromptCache || false}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setApiConfiguration({
							...apiConfiguration,
							liteLlmUsePromptCache: isChecked,
						})
					}}
					style={{ fontWeight: 500, color: "var(--vscode-charts-green)" }}>
					Use prompt caching (GA)
				</VSCodeCheckbox>
				<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-charts-green)" }}>
					Prompt caching requires a supported provider and model
				</p>
			</div>

			<ThinkingBudgetSlider apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Extended thinking is available for models as Sonnet-3-7, o3-mini, Deepseek R1, etc. More info on{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					thinking mode configuration
				</VSCodeLink>
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				LiteLLM provides a unified interface to access various LLM providers' models. See their{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide
				</VSCodeLink>{" "}
				for more information.
			</p>
		</div>
	)
}

export default LiteLLMOptions
