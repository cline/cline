import { VSCodeTextField, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import { getOpenRouterAuthUrl } from "@/utils/providers"
import OpenRouterModelPicker, { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../../OpenRouterModelPicker"
import DropdownContainer from "../DropdownContainer"
import { useState } from "react"
import VSCodeButtonLink from "../../../common/VSCodeButtonLink"

const OpenRouterOptions = ({ showModelOptions, isPopup, handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration, uriScheme } = useExtensionState()
	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.openRouterApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("openRouterApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
			</VSCodeTextField>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ margin: "5px 0 0 0" }} appearance="secondary">
					Get OpenRouter API Key
				</VSCodeButtonLink>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				This key is stored locally and only used to make API requests from this extension.
			</p>

			{showModelOptions && (
				<>
					<VSCodeCheckbox
						style={{ marginTop: -10 }}
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								setApiConfiguration({
									...apiConfiguration,
									openRouterProviderSorting: "",
								})
							}
						}}>
						Sort underlying provider routing
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.openRouterProviderSorting}
									onChange={(e: any) => {
										setApiConfiguration({
											...apiConfiguration,
											openRouterProviderSorting: e.target.value,
										})
									}}>
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

					<OpenRouterModelPicker isPopup={isPopup} />
				</>
			)}
		</div>
	)
}

export default OpenRouterOptions
