import { ModelPicker } from "./ModelPicker"
import { requestyDefaultModelId } from "../../../../src/shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const RequestyModelPicker = () => {
	const { apiConfiguration } = useExtensionState()
	return (
		<ModelPicker
			defaultModelId={requestyDefaultModelId}
			modelsKey="requestyModels"
			configKey="requestyModelId"
			infoKey="requestyModelInfo"
			refreshMessageType="refreshRequestyModels"
			refreshValues={{
				apiKey: apiConfiguration?.requestyApiKey,
			}}
			serviceName="Requesty"
			serviceUrl="https://requesty.ai"
			recommendedModel="anthropic/claude-3-5-sonnet-latest"
		/>
	)
}
