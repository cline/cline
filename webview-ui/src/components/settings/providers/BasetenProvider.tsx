import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import BasetenModelPicker from "../BasetenModelPicker"
import { ApiKeyField } from "../common/ApiKeyField"

/**
 * Props for the BasetenProvider component
 */
interface BasetenProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Baseten provider configuration component
 */
export const BasetenProvider = ({ showModelOptions, isPopup, currentMode }: BasetenProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.basetenApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									basetenApiKey: value,
								},
							},
							updateMask: ["secrets.basetenApiKey"],
						}),
					)
				}}
				providerName="Baseten"
				signupUrl="https://app.baseten.co/settings/api_keys"
			/>

			{showModelOptions && <BasetenModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
