import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import CortecsModelPicker from "../CortecsModelPicker"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the CortecsProvider component
 */
interface CortecsProviderProps {
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Cortecs provider configuration component
 */
export const CortecsProvider = ({ isPopup, currentMode }: CortecsProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [cortecsEndpointSelected, setCortecsEndpointSelected] = useState(!!apiConfiguration?.cortecsBaseUrl)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.cortecsApiKey || ""}
				onChange={(value) => handleFieldChange("cortecsApiKey", value)}
				providerName="Cortecs"
				signupUrl="https://docs.cortecs.ai/quickstart"
			/>
			<VSCodeCheckbox
				checked={cortecsEndpointSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setCortecsEndpointSelected(isChecked)

					if (!isChecked) {
						handleFieldChange("cortecsBaseUrl", "")
					}
				}}>
				Use custom base URL
			</VSCodeCheckbox>
			{cortecsEndpointSelected && (
				<DebouncedTextField
					initialValue={apiConfiguration?.cortecsBaseUrl ?? ""}
					onChange={(value) => {
						handleFieldChange("cortecsBaseUrl", value)
					}}
					placeholder="Custom base URL"
					style={{ width: "100%", marginBottom: 5 }}
					type="url"
				/>
			)}
			<CortecsModelPicker baseUrl={apiConfiguration?.cortecsBaseUrl} currentMode={currentMode} isPopup={isPopup} />
		</div>
	)
}
