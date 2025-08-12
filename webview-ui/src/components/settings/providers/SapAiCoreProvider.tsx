import { useState, useCallback, useEffect } from "react"
import { VSCodeLink, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Mode } from "@shared/storage/types"
import { ModelsServiceClient } from "@/services/grpc-client"
import { SapAiCoreModelsRequest } from "@shared/proto/index.cline"
import SapAiCoreModelPicker from "../SapAiCoreModelPicker"
/**
 * Props for the SapAiCoreProvider component
 */
interface SapAiCoreProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The SAP AI Core provider configuration component
 */
export const SapAiCoreProvider = ({ showModelOptions, isPopup, currentMode }: SapAiCoreProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Handle orchestration checkbox change
	const handleOrchestrationChange = async (checked: boolean) => {
		await handleFieldChange("sapAiCoreUseOrchestrationMode", checked)
	}

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// State for dynamic model fetching
	const [deployedModelsArray, setDeployedModelsArray] = useState<string[]>([])
	const [isLoadingModels, setIsLoadingModels] = useState(false)
	const [modelError, setModelError] = useState<string | null>(null)

	// Check if all required credentials are available
	const hasRequiredCredentials =
		apiConfiguration?.sapAiCoreClientId &&
		apiConfiguration?.sapAiCoreClientSecret &&
		apiConfiguration?.sapAiCoreBaseUrl &&
		apiConfiguration?.sapAiCoreTokenUrl &&
		apiConfiguration?.sapAiResourceGroup

	// Function to fetch SAP AI Core models
	const fetchSapAiCoreModels = useCallback(async () => {
		if (!hasRequiredCredentials) {
			setDeployedModelsArray([])
			return
		}

		setIsLoadingModels(true)
		setModelError(null)

		try {
			const response = await ModelsServiceClient.getSapAiCoreModels(
				SapAiCoreModelsRequest.create({
					clientId: apiConfiguration.sapAiCoreClientId,
					clientSecret: apiConfiguration.sapAiCoreClientSecret,
					baseUrl: apiConfiguration.sapAiCoreBaseUrl,
					tokenUrl: apiConfiguration.sapAiCoreTokenUrl,
					resourceGroup: apiConfiguration.sapAiResourceGroup,
				}),
			)

			if (response && response.values) {
				setDeployedModelsArray(response.values)
			} else {
				setDeployedModelsArray([])
			}
		} catch (error) {
			console.error("Error fetching SAP AI Core models:", error)
			setModelError("Failed to fetch models. Please check your configuration.")
			setDeployedModelsArray([])
		} finally {
			setIsLoadingModels(false)
		}
	}, [
		apiConfiguration?.sapAiCoreClientId,
		apiConfiguration?.sapAiCoreClientSecret,
		apiConfiguration?.sapAiCoreBaseUrl,
		apiConfiguration?.sapAiCoreTokenUrl,
		apiConfiguration?.sapAiResourceGroup,
	])

	// Fetch models when configuration changes
	useEffect(() => {
		if (showModelOptions && hasRequiredCredentials) {
			fetchSapAiCoreModels()
		}
	}, [showModelOptions, hasRequiredCredentials, fetchSapAiCoreModels])

	// Handle model selection
	const handleModelChange = useCallback(
		(modelId: string) => {
			handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, currentMode)
		},
		[handleModeFieldChange, currentMode],
	)

	return (
		<div className="flex flex-col gap-1.5">
			<DebouncedTextField
				initialValue={apiConfiguration?.sapAiCoreClientId || ""}
				onChange={(value) => handleFieldChange("sapAiCoreClientId", value)}
				style={{ width: "100%" }}
				type="password"
				placeholder="Enter AI Core Client Id...">
				<span className="font-medium">AI Core Client Id</span>
			</DebouncedTextField>
			{apiConfiguration?.sapAiCoreClientId && (
				<p className="text-xs text-[var(--vscode-descriptionForeground)]">
					Client Id is set. To change it, please re-enter the value.
				</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.sapAiCoreClientSecret || ""}
				onChange={(value) => handleFieldChange("sapAiCoreClientSecret", value)}
				style={{ width: "100%" }}
				type="password"
				placeholder="Enter AI Core Client Secret...">
				<span className="font-medium">AI Core Client Secret</span>
			</DebouncedTextField>
			{apiConfiguration?.sapAiCoreClientSecret && (
				<p className="text-xs text-[var(--vscode-descriptionForeground)]">
					Client Secret is set. To change it, please re-enter the value.
				</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.sapAiCoreBaseUrl || ""}
				onChange={(value) => handleFieldChange("sapAiCoreBaseUrl", value)}
				style={{ width: "100%" }}
				placeholder="Enter AI Core Base URL...">
				<span className="font-medium">AI Core Base URL</span>
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={apiConfiguration?.sapAiCoreTokenUrl || ""}
				onChange={(value) => handleFieldChange("sapAiCoreTokenUrl", value)}
				style={{ width: "100%" }}
				placeholder="Enter AI Core Auth URL...">
				<span className="font-medium">AI Core Auth URL</span>
			</DebouncedTextField>

			<DebouncedTextField
				initialValue={apiConfiguration?.sapAiResourceGroup || ""}
				onChange={(value) => handleFieldChange("sapAiResourceGroup", value)}
				style={{ width: "100%" }}
				placeholder="Enter AI Core Resource Group...">
				<span className="font-medium">AI Core Resource Group</span>
			</DebouncedTextField>

			<div className="flex flex-col gap-2.5 mt-[15px]">
				<div className="flex items-center gap-2">
					<VSCodeCheckbox
						checked={apiConfiguration?.sapAiCoreUseOrchestrationMode ?? true}
						onChange={(e) => handleOrchestrationChange((e.target as HTMLInputElement).checked)}
						aria-label="Orchestration Mode"
					/>
					<span className="font-medium">Orchestration Mode</span>
				</div>

				<p className="text-xs text-[var(--vscode-descriptionForeground)]">
					Enable to use the harmonized API that provides access to all available models without requiring individual
					deployments. When disabled, uses the traditional AI Core deployment-based approach.
				</p>
			</div>

			<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
				These credentials are stored locally and only used to make API requests from this extension.
				<VSCodeLink
					href="https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/access-sap-ai-core-via-api"
					className="inline">
					You can find more information about SAP AI Core API access here.
				</VSCodeLink>
			</p>

			{showModelOptions && (
				<>
					<div className="flex flex-col gap-1.5">
						{isLoadingModels ? (
							<div className="text-xs text-[var(--vscode-descriptionForeground)]">Loading models...</div>
						) : modelError ? (
							<div className="text-xs text-[var(--vscode-errorForeground)]">
								{modelError}
								<button
									onClick={fetchSapAiCoreModels}
									className="ml-2 text-[11px] px-1.5 py-0.5 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-none rounded-sm cursor-pointer">
									Retry
								</button>
							</div>
						) : hasRequiredCredentials ? (
							<>
								{deployedModelsArray.length === 0 && (
									<div className="text-xs text-[var(--vscode-errorForeground)] mb-2">
										Unable to fetch models from SAP AI Core service instance. Please check your SAP AI Core
										configuration or ensure your deployments are deployed and running in the service instance
									</div>
								)}
								<SapAiCoreModelPicker
									sapAiCoreDeployedModels={deployedModelsArray}
									selectedModelId={selectedModelId || ""}
									onModelChange={handleModelChange}
									placeholder="Select a model..."
								/>
							</>
						) : (
							<div className="text-xs text-[var(--vscode-errorForeground)]">
								Please configure your SAP AI Core credentials to see available models.
							</div>
						)}
					</div>

					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
