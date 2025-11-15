import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"

interface DifyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const DifyProvider = ({ showModelOptions, isPopup, currentMode }: DifyProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.difyBaseUrl || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									options: {
										difyBaseUrl: value,
									},
								},
								updateMask: ["options.difyBaseUrl"],
							}),
						)
					}}
					placeholder={"Enter base URL..."}
					style={{ width: "100%", marginBottom: 10 }}
					type="text">
					<span style={{ fontWeight: 500 }}>Base URL</span>
				</DebouncedTextField>

				<ApiKeyField
					initialValue={apiConfiguration?.difyApiKey || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									secrets: {
										difyApiKey: value,
									},
								},
								updateMask: ["secrets.difyApiKey"],
							}),
						)
					}}
					providerName="Dify"
				/>

				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "5px" }}>
					<p>
						Dify is a platform that provides access to various AI models through a unified API. Configure your Dify
						instance URL and API key to get started.
					</p>
					<p style={{ marginTop: "8px" }}>
						<strong>Note:</strong> The model selection is handled within your Dify application configuration.
					</p>
				</div>
			</div>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
