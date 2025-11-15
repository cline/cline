import { mistralModels } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the MistralProvider component
 */
interface MistralProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Mistral provider configuration component
 */
export const MistralProvider = ({ showModelOptions, isPopup, currentMode }: MistralProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.mistralApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									mistralApiKey: value,
								},
							},
							updateMask: ["secrets.mistralApiKey"],
						}),
					)
				}}
				providerName="Mistral"
				signupUrl="https://console.mistral.ai/codestral"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={mistralModels}
						onChange={async (e: any) => {
							const value = e.target.value

							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create(
									currentMode === "plan"
										? {
												updates: { options: { planModeApiModelId: value } },
												updateMask: ["options.planModeApiModelId"],
											}
										: {
												updates: { options: { actModeApiModelId: value } },
												updateMask: ["options.actModeApiModelId"],
											},
								),
							)
						}}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
