import type { ProviderListItem } from "@shared/proto/cline/models"
import { UpdateSdkProviderSettingsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { DropdownContainer } from "../common/ModelSelector"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useDebouncedInput } from "../utils/useDebouncedInput"

interface GenericSdkProviderProps {
	provider: ProviderListItem
	currentMode: Mode
	showModelOptions: boolean
	selectedModelId?: string
}

export const GenericSdkProvider = ({
	provider,
	currentMode,
	showModelOptions,
	selectedModelId: selectedModelIdProp,
}: GenericSdkProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedModelId =
		selectedModelIdProp || modeFields.apiModelId || provider.defaultModelId || provider.modelList[0]?.id || ""

	const saveSettings = (updates: Partial<UpdateSdkProviderSettingsRequest>) => {
		ModelsServiceClient.updateSdkProviderSettings(
			UpdateSdkProviderSettingsRequest.create({
				providerId: provider.id,
				mode: currentMode,
				modelId: selectedModelId || undefined,
				enabled: true,
				...updates,
			}),
		).catch((error) => {
			console.error("Failed to update SDK provider settings:", error)
		})
	}

	const [baseUrl, setBaseUrl] = useDebouncedInput(provider.baseUrl || "", (value) => {
		saveSettings({ baseUrl: value || undefined })
	})
	const [customModelId, setCustomModelId] = useDebouncedInput(selectedModelId, (value) => {
		saveSettings({ modelId: value || undefined })
	})

	const modelOptions = useMemo(() => provider.modelList || [], [provider.modelList])

	return (
		<div>
			<ApiKeyField
				helpText={provider.authDescription || undefined}
				initialValue={provider.apiKey || ""}
				onChange={(value) => saveSettings({ apiKey: value || undefined })}
				providerName={provider.name || provider.id}
			/>

			<VSCodeTextField
				onInput={(e: any) => setBaseUrl(e.target.value)}
				placeholder="Provider default"
				style={{ width: "100%" }}
				value={baseUrl}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>
			<p className="text-xs mt-[3px] text-(--vscode-descriptionForeground)">
				{provider.baseUrlDescription || "The base endpoint to use for provider requests."}
			</p>

			{showModelOptions && modelOptions.length > 0 && (
				<DropdownContainer className="dropdown-container">
					<label htmlFor={`sdk-model-id-${provider.id}`}>
						<span className="font-medium">Model</span>
					</label>
					<VSCodeDropdown
						className="w-full"
						id={`sdk-model-id-${provider.id}`}
						onChange={(e: any) => saveSettings({ modelId: e.target.value })}
						value={selectedModelId}>
						<VSCodeOption value="">Select a model...</VSCodeOption>
						{modelOptions.map((model) => (
							<VSCodeOption className="break-words whitespace-normal max-w-full" key={model.id} value={model.id}>
								{model.name || model.id}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			)}

			{showModelOptions && modelOptions.length === 0 && (
				<VSCodeTextField
					onInput={(e: any) => setCustomModelId(e.target.value)}
					placeholder="Enter Model ID..."
					style={{ width: "100%" }}
					value={customModelId}>
					<span style={{ fontWeight: 500 }}>Model</span>
				</VSCodeTextField>
			)}

			<p className="text-xs mt-[8px] text-(--vscode-descriptionForeground)">
				Provider ID: <code>{provider.id}</code>
				{provider.protocol ? (
					<>
						{" • "}Protocol: <code>{provider.protocol}</code>
					</>
				) : null}
			</p>
		</div>
	)
}
