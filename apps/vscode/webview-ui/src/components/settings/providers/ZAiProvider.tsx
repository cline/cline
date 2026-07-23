import { openAiModelInfoSafeDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

const PROVIDER_ID = "zai"

// VSCodeDropdown's onChange supplies `Event | React.FormEvent<HTMLElement>`,
// so accept the same union here. We only read `target.value`, which is present
// on both, so no narrowing of the event itself is required.
function getEventValue(event: Event | React.FormEvent<HTMLElement>): string {
	const target = event.target
	if (target && "value" in target && typeof target.value === "string") {
		return target.value
	}
	return ""
}

/**
 * Props for the ZAiProvider component
 */
interface ZAiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Z AI provider configuration component.
 *
 * Model catalog and default come from the `@cline/llms` SDK via gRPC.
 * The SDK consumes `apiLine` from the effective provider config so the
 * international vs. mainland catalog selection happens upstream — the
 * webview sees a single catalog per render.
 */
export const ZAiProvider = ({ showModelOptions, isPopup, currentMode }: ZAiProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { config, write, commitSelection } = useProviderConfig(PROVIDER_ID)
	const {
		models,
		defaultModelId,
		selectedModelId: legacySelectedModelId,
		selectedModelInfo: legacySelectedModelInfo,
		hideUsageCost,
	} = useStaticProviderSelection(PROVIDER_ID, apiConfiguration, currentMode)
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(PROVIDER_ID, currentMode, {
		models,
		defaultModelId: legacySelectedModelId,
		config,
		commitSelection,
		fallbackModelInfo: legacySelectedModelInfo,
	})
	const selectedEntrypoint = config?.apiLine || apiConfiguration?.zaiApiLine || "international"
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Z AI",
		write,
	})

	const handleApiLineChange = (value: string) => {
		void write({ apiLine: value }).catch((err) => console.error("Failed to update Z AI entrypoint:", err))
	}

	const handleModelChange = (modelId: string) => {
		if (!modelId) {
			return
		}

		const fallbackModelId = defaultModelId || Object.keys(models)[0] || modelId
		const modelInfo = models[modelId] ?? models[fallbackModelId] ?? selectedModelInfo ?? openAiModelInfoSafeDefaults

		void commitModelSelection({
			modelId,
			modelInfo,
		}).catch((err) => console.error("Failed to commit Z AI model selection:", err))
	}

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="zai-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Z AI Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="zai-entrypoint"
					onChange={(event) => handleApiLineChange(getEventValue(event))}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={selectedEntrypoint}>
					<VSCodeOption value="international">api.z.ai</VSCodeOption>
					<VSCodeOption value="china">open.bigmodel.cn</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Please select the appropriate API entrypoint based on your location. If you are in China, choose open.bigmodel.cn
				. Otherwise, choose api.z.ai.
			</p>
			<ApiKeyField
				initialValue={savedApiKeyMask || apiConfiguration?.zaiApiKey || ""}
				onChange={handleApiKeyChange}
				providerName="Z AI"
				signupUrl={
					selectedEntrypoint === "china"
						? "https://open.bigmodel.cn/console/overview"
						: "https://z.ai/manage-apikey/apikey-list"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="模型"
						models={models}
						onChange={(event: Event) => handleModelChange(getEventValue(event))}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
