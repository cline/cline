import { type ApiConfiguration, BEDROCK_DEFAULT_MODEL_ID, BEDROCK_DEFAULT_REGION } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

const BEDROCK_MODELS = [
	{ id: "anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
	{ id: "anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6" },
	{ id: "anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5" },
] as const

interface BedrockProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const BedrockProvider = ({ showModelOptions, currentMode }: BedrockProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const config = apiConfiguration ?? {}
	const selectedModel =
		(currentMode === "plan" ? config.planModeApiModelId : config.actModeApiModelId) || BEDROCK_DEFAULT_MODEL_ID

	const saveConnection = <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
		void handleFieldChange(field, value)
	}

	return (
		<div className="flex flex-col gap-3">
			<div>
				<h3 className="m-0">AWS Bedrock</h3>
				<p className="text-description m-0 mt-1">
					Credentials come from the extension environment or the selected AWS profile. Authenticate SSO profiles
					externally with the AWS CLI.
				</p>
			</div>

			<DebouncedTextField
				initialValue={config.awsRegion || BEDROCK_DEFAULT_REGION}
				onChange={(value) => saveConnection("awsRegion", value)}
				placeholder={BEDROCK_DEFAULT_REGION}
				style={{ width: "100%" }}>
				AWS region
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsProfile || ""}
				onChange={(value) => saveConnection("awsProfile", value || undefined)}
				placeholder="Optional, e.g. engineering-sso"
				style={{ width: "100%" }}>
				AWS profile (optional)
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsBedrockEndpoint || ""}
				onChange={(value) => saveConnection("awsBedrockEndpoint", value || undefined)}
				placeholder="Optional HTTPS endpoint"
				style={{ width: "100%" }}>
				Bedrock endpoint (optional)
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={config.awsBedrockCaBundlePath || ""}
				onChange={(value) => saveConnection("awsBedrockCaBundlePath", value || undefined)}
				placeholder="Optional absolute or workspace-relative PEM path"
				style={{ width: "100%" }}>
				CA bundle path (optional)
			</DebouncedTextField>

			{showModelOptions && (
				<label className="flex flex-col gap-1">
					<span>Bedrock model</span>
					<VSCodeDropdown
						onChange={(event) => {
							const modelId = (event.target as HTMLSelectElement).value
							void handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								modelId,
								currentMode,
							)
						}}
						style={{ width: "100%" }}
						value={selectedModel}>
						{BEDROCK_MODELS.map((model) => (
							<VSCodeOption key={model.id} value={model.id}>
								{model.label}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</label>
			)}
		</div>
	)
}
