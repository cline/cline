import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import DropdownContainer from "./DropdownContainer"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./model/OpenRouterModelPicker"
import { useExtensionState } from "@/context/ExtensionStateContext"

const OpenRouterProviderSorter = () => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)
	return (
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
		</>
	)
}

export default memo(OpenRouterProviderSorter)
