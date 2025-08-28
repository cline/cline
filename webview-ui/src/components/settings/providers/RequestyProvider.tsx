import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import RequestyModelPicker from "../RequestyModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the RequestyProvider component
 */
interface RequestyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Requesty provider configuration component
 */
export const RequestyProvider = ({ showModelOptions, isPopup, currentMode }: RequestyProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [requestyEndpointSelected, setRequestyEndpointSelected] = useState(!!apiConfiguration?.requestyBaseUrl)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.requestyApiKey || ""}
				onChange={(value) => handleFieldChange("requestyApiKey", value)}
				providerName="Requesty"
				signupUrl="https://app.requesty.ai/api-keys"
			/>
			<VSCodeCheckbox
				checked={requestyEndpointSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setRequestyEndpointSelected(isChecked)

					if (!isChecked) {
						handleFieldChange("requestyBaseUrl", "")
					}
				}}>
				Use custom base URL
			</VSCodeCheckbox>
			{requestyEndpointSelected && (
				<DebouncedTextField
					initialValue={apiConfiguration?.requestyBaseUrl ?? ""}
					onChange={(value) => {
						handleFieldChange("requestyBaseUrl", value)
					}}
					placeholder="Custom base URL"
					style={{ width: "100%", marginBottom: 5 }}
					type="url"
				/>
			)}
			{showModelOptions && <RequestyModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
