import { moonshotModels } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the MoonshotProvider component
 */
interface MoonshotProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Moonshot AI Studio provider configuration component
 */
export const MoonshotProvider = ({ showModelOptions, isPopup, currentMode }: MoonshotProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="moonshot-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Moonshot Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="moonshot-entrypoint"
					onChange={async (e) => {
						const value = (e.target as any).value
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									options: {
										moonshotApiLine: value,
									},
								},
								updateMask: ["options.moonshotApiLine"],
							}),
						)
					}}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={apiConfiguration?.moonshotApiLine || "international"}>
					<VSCodeOption value="international">api.moonshot.ai</VSCodeOption>
					<VSCodeOption value="china">api.moonshot.cn</VSCodeOption>
				</VSCodeDropdown>
			</DropdownContainer>
			<ApiKeyField
				helpText="This key is stored locally and only used to make API requests from this extension."
				initialValue={apiConfiguration?.moonshotApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									moonshotApiKey: value,
								},
							},
							updateMask: ["secrets.moonshotApiKey"],
						}),
					)
				}}
				providerName="Moonshot"
				signupUrl={
					apiConfiguration?.moonshotApiLine === "china"
						? "https://platform.moonshot.cn/console/api-keys"
						: "https://platform.moonshot.ai/console/api-keys"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={moonshotModels}
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
