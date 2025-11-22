import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import GroqModelPicker from "../GroqModelPicker"

/**
 * Props for the GroqProvider component
 */
interface GroqProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Groq provider configuration component
 */
export const GroqProvider = ({ showModelOptions, isPopup, currentMode }: GroqProviderProps) => {
	const { apiConfiguration } = useExtensionState()

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.groqApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									groqApiKey: value,
								},
							},
							updateMask: ["secrets.groqApiKey"],
						}),
					)
				}}
				providerName="Groq"
				signupUrl="https://console.groq.com/keys"
			/>

			{showModelOptions && <GroqModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
