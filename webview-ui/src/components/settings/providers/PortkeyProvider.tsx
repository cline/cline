import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface PortkeyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const PORTKEY_DEFAULT_BASE_URL = "https://api.portkey.ai/v1"

export const PortkeyProvider = ({ showModelOptions, isPopup, currentMode }: PortkeyProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const [availableModels, setAvailableModels] = useState<string[]>([])
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
	const baseUrlRef = useRef<string>(apiConfiguration?.openAiBaseUrl || PORTKEY_DEFAULT_BASE_URL)
	const apiKeyRef = useRef<string>(apiConfiguration?.openAiApiKey || "")

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const debouncedRefreshModels = useCallback((baseUrl?: string, apiKey?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		const effectiveBaseUrl = baseUrl || baseUrlRef.current
		const effectiveApiKey = apiKey || apiKeyRef.current

		if (effectiveBaseUrl && effectiveApiKey) {
			debounceTimerRef.current = setTimeout(() => {
				ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl: effectiveBaseUrl,
						apiKey: effectiveApiKey,
					}),
				)
					.then((resp) => {
						const values = resp?.values ?? []
						setAvailableModels(values)
					})
					.catch((error) => {
						console.error("Failed to refresh Portkey models:", error)
						setAvailableModels([])
					})
			}, 500)
		}
	}, [])

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.openAiBaseUrl || PORTKEY_DEFAULT_BASE_URL}
				onChange={(value) => {
					baseUrlRef.current = value || PORTKEY_DEFAULT_BASE_URL
					handleFieldChange("openAiBaseUrl", value)
					debouncedRefreshModels(baseUrlRef.current, apiKeyRef.current)
				}}
				placeholder={`Default: ${PORTKEY_DEFAULT_BASE_URL}`}
				style={{ width: "100%", marginBottom: 10 }}
				type="url">
				<span style={{ fontWeight: 500 }}>Gateway URL (optional)</span>
			</DebouncedTextField>

			<ApiKeyField
				initialValue={apiConfiguration?.openAiApiKey || ""}
				onChange={(value) => {
					apiKeyRef.current = value
					handleFieldChange("openAiApiKey", value)
					debouncedRefreshModels(baseUrlRef.current, apiKeyRef.current)
				}}
				providerName="Portkey"
			/>

			{availableModels.length > 0 ? (
				<div style={{ width: "100%", marginBottom: 10 }}>
					<label htmlFor="portkey-model-id">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</label>
					<VSCodeDropdown
						id="portkey-model-id"
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
								e.target.value,
								currentMode,
							)
						}
						style={{ width: "100%" }}
						value={selectedModelId || ""}>
						<VSCodeOption value="">Select a model...</VSCodeOption>
						{availableModels.map((m) => (
							<VSCodeOption key={m} value={m}>
								{m}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</div>
			) : (
				<DebouncedTextField
					initialValue={selectedModelId || ""}
					onChange={(value) =>
						handleModeFieldChange({ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" }, value, currentMode)
					}
					placeholder={"Enter Model ID..."}
					style={{ width: "100%", marginBottom: 10 }}>
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</DebouncedTextField>
			)}

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
