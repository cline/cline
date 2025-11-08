import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import { DropdownContainer } from "../common/ModelSelector"
import OpenRouterModelPicker, { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../OpenRouterModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the ClineProvider component
 */
interface ClineProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Cline provider configuration component
 */
export const ClineProvider = ({ showModelOptions, isPopup, currentMode }: ClineProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { t } = useTranslation("common")

	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)

	return (
		<div>
			{/* Cline Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard />
			</div>

			{showModelOptions && (
				<>
					{/* Provider Sorting Options */}
					<VSCodeCheckbox
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								handleFieldChange("openRouterProviderSorting", "")
							}
						}}
						style={{ marginTop: -10 }}>
						{t("api_provider.cline.sort_provider_routing_label")}
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									onChange={(e: any) => {
										handleFieldChange("openRouterProviderSorting", e.target.value)
									}}
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.openRouterProviderSorting}>
									<VSCodeOption value="">
										{t("api_provider.cline.provider_sorting_options.default")}
									</VSCodeOption>
									<VSCodeOption value="price">
										{t("api_provider.cline.provider_sorting_options.price")}
									</VSCodeOption>
									<VSCodeOption value="throughput">
										{t("api_provider.cline.provider_sorting_options.throughput")}
									</VSCodeOption>
									<VSCodeOption value="latency">
										{t("api_provider.cline.provider_sorting_options.latency")}
									</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.openRouterProviderSorting &&
									t("api_provider.cline.provider_sorting_descriptions.default")}
								{apiConfiguration?.openRouterProviderSorting === "price" &&
									t("api_provider.cline.provider_sorting_descriptions.price")}
								{apiConfiguration?.openRouterProviderSorting === "throughput" &&
									t("api_provider.cline.provider_sorting_descriptions.throughput")}
								{apiConfiguration?.openRouterProviderSorting === "latency" &&
									t("api_provider.cline.provider_sorting_descriptions.latency")}
							</p>
						</div>
					)}

					{/* OpenRouter Model Picker */}
					<OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
