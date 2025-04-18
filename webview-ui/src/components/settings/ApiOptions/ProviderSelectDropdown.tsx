import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { ApiProvider } from "@shared/api"
import DropdownContainer from "./DropdownContainer"

// Provider list array with name and id
export const providerList = [
	{ id: "cline", name: "Cline" },
	{ id: "openrouter", name: "OpenRouter" },
	{ id: "anthropic", name: "Anthropic" },
	{ id: "bedrock", name: "AWS Bedrock" },
	{ id: "openai", name: "OpenAI Compatible" },
	{ id: "vertex", name: "GCP Vertex AI" },
	{ id: "gemini", name: "Google Gemini" },
	{ id: "deepseek", name: "DeepSeek" },
	{ id: "mistral", name: "Mistral" },
	{ id: "openai-native", name: "OpenAI" },
	{ id: "vscode-lm", name: "VS Code LM API" },
	{ id: "requesty", name: "Requesty" },
	{ id: "together", name: "Together" },
	{ id: "qwen", name: "Alibaba Qwen" },
	{ id: "doubao", name: "Bytedance Doubao" },
	{ id: "lmstudio", name: "LM Studio" },
	{ id: "ollama", name: "Ollama" },
	{ id: "litellm", name: "LiteLLM" },
	{ id: "asksage", name: "AskSage" },
	{ id: "xai", name: "xAI" },
	{ id: "sambanova", name: "SambaNova" },
]

interface ProviderDropdownProps {
	selectedProvider: ApiProvider
	onChange: (event: any) => void
}

const ProviderSelectDropdown = ({ selectedProvider, onChange }: ProviderDropdownProps) => {
	return (
		<DropdownContainer className="dropdown-container">
			<label htmlFor="api-provider">
				<span style={{ fontWeight: 500 }}>API Provider</span>
			</label>
			<VSCodeDropdown
				id="api-provider"
				value={selectedProvider}
				onChange={onChange}
				style={{
					minWidth: 130,
					position: "relative",
				}}>
				{providerList.map((provider) => (
					<VSCodeOption key={provider.id} value={provider.id}>
						{provider.name}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		</DropdownContainer>
	)
}

export default ProviderSelectDropdown
