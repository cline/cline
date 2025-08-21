import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
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
						Sort underlying provider routing
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
									<VSCodeOption value="">Default</VSCodeOption>
									<VSCodeOption value="price">Price</VSCodeOption>
									<VSCodeOption value="throughput">Throughput</VSCodeOption>
									<VSCodeOption value="latency">Latency</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.openRouterProviderSorting &&
									"Default behavior is to load balance requests across providers (like AWS, Google Vertex, Anthropic), prioritizing price while considering provider uptime"}
								{apiConfiguration?.openRouterProviderSorting === "price" &&
									"Sort providers by price, prioritizing the lowest cost provider"}
								{apiConfiguration?.openRouterProviderSorting === "throughput" &&
									"Sort providers by throughput, prioritizing the provider with the highest throughput (may increase cost)"}
								{apiConfiguration?.openRouterProviderSorting === "latency" &&
									"Sort providers by response time, prioritizing the provider with the lowest latency"}
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
