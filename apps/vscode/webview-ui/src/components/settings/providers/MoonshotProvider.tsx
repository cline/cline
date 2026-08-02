import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"

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
	const { config, write } = useProviderConfig("moonshot")

	// Get the normalized configuration
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"moonshot",
		apiConfiguration,
		currentMode,
	)

	// The SDK provider config (providers.json) is the source of truth shared
	// with other hosts (CLI, desktop app); the legacy state field keeps the
	// dropdown accurate before the async config read completes.
	const selectedEntrypoint = config?.apiLine || apiConfiguration?.moonshotApiLine || "international"

	const handleApiLineChange = (value: string) => {
		// write() persists to providers.json and mirrors to the legacy
		// `moonshotApiLine` state key host-side, keeping both stores in sync.
		void write({ apiLine: value }).catch((err) => console.error("Failed to update Moonshot entrypoint:", err))
	}

	return (
		<div>
			<DropdownContainer className="dropdown-container" style={{ position: "inherit" }}>
				<label htmlFor="moonshot-entrypoint">
					<span style={{ fontWeight: 500, marginTop: 5 }}>Moonshot Entrypoint</span>
				</label>
				<VSCodeDropdown
					id="moonshot-entrypoint"
					onChange={(e) => {
						handleApiLineChange((e.target as any).value)
					}}
					style={{
						minWidth: 130,
						position: "relative",
					}}
					value={selectedEntrypoint}>
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
					selectedEntrypoint === "china"
						? "https://platform.moonshot.cn/console/api-keys"
						: "https://platform.moonshot.ai/console/api-keys"
				}
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
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

					{selectedModelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined },
								}).catch((err) => console.error("Failed to update Moonshot reasoning effort:", err))
							}}
						/>
					)}

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
