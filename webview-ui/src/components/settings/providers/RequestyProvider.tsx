import { ApiConfiguration } from "@shared/api"
import { ApiKeyField } from "../common/ApiKeyField"
import RequestyModelPicker from "../RequestyModelPicker"

/**
 * Props for the RequestyProvider component
 */
interface RequestyProviderProps {
	apiConfiguration: ApiConfiguration
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	showModelOptions: boolean
	isPopup?: boolean
}

/**
 * The Requesty provider configuration component
 */
export const RequestyProvider = ({ apiConfiguration, handleInputChange, showModelOptions, isPopup }: RequestyProviderProps) => {
	return (
		<div>
			<ApiKeyField
				value={apiConfiguration?.requestyApiKey || ""}
				onChange={handleInputChange("requestyApiKey")}
				providerName="Requesty"
				signupUrl="https://app.requesty.ai/manage-api"
			/>

			{showModelOptions && <RequestyModelPicker isPopup={isPopup} />}
		</div>
	)
}
