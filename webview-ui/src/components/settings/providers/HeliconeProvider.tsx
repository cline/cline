import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import HeliconeModelPicker from "../HeliconeModelPicker"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface HeliconeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const HeliconeProvider = ({ showModelOptions, isPopup, currentMode }: HeliconeProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// No local fetch here; HeliconeModelPicker handles refresh using context

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.heliconeApiKey || ""}
					onChange={(value) => handleFieldChange("heliconeApiKey", value)}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<span style={{ fontWeight: 500 }}>Helicone API Key</span>
				</DebouncedTextField>
				<div style={{ marginTop: 6 }}>
					<div
						style={{
							fontSize: 12,
							color: "var(--vscode-descriptionForeground)",
							marginBottom: 4,
						}}>
						Generate Helicone API Key:
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<a
							href="https://us.helicone.ai/settings/api-keys"
							rel="noopener noreferrer"
							style={{
								background: "var(--vscode-button-secondaryBackground)",
								color: "var(--vscode-button-foreground)",
								border: "1px solid var(--vscode-button-secondaryBorder, transparent)",
								padding: "3px 9px",
								borderRadius: 3,
								cursor: "pointer",
								textDecoration: "none",
								display: "inline-flex",
								width: "100%",
								alignItems: "center",
								justifyContent: "center",
							}}
							target="_blank">
							🇺🇸 US
						</a>
						<a
							href="https://eu.helicone.ai/settings/api-keys"
							rel="noopener noreferrer"
							style={{
								background: "var(--vscode-button-secondaryBackground)",
								color: "var(--vscode-button-foreground)",
								border: "1px solid var(--vscode-button-secondaryBorder, transparent)",
								padding: "3px 9px",
								borderRadius: 3,
								cursor: "pointer",
								textDecoration: "none",
								display: "inline-flex",
								width: "100%",
								alignItems: "center",
								justifyContent: "center",
							}}
							target="_blank">
							🇪🇺 EU
						</a>
					</div>
				</div>
				<p
					style={{
						fontSize: "12px",
						marginTop: 8,
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension.
				</p>
			</div>

			{showModelOptions && (
				<>
					<HeliconeModelPicker currentMode={currentMode} isPopup={isPopup} />

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />

					<div>
						{/* Model Support Info Modal*/}
						<span
							style={{
								fontWeight: 500,
								color: "var(--vscode-charts-green)",
							}}>
							<i
								className={`codicon codicon-check`}
								style={{
									marginRight: 4,
									marginBottom: 1,
									fontSize: 11,
									fontWeight: 700,
									display: "inline-block",
									verticalAlign: "bottom",
								}}></i>
							Supported by Helicone Prompt Caching!
						</span>
						<p
							style={{
								fontSize: "12px",
								marginTop: 2,
								color: "var(--vscode-descriptionForeground)",
							}}>
							Learn more{" "}
							<a
								href="https://docs.helicone.ai/helicone-headers/header-directory#param-helicone-cache-enabled"
								rel="noopener noreferrer"
								style={{
									color: "var(--vscode-link-foreground)",
									textDecoration: "underline",
								}}
								target="_blank">
								here
							</a>
							.
						</p>
					</div>
				</>
			)}
		</div>
	)
}
