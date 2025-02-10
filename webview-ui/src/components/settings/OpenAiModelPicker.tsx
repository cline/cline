import React from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelPicker } from "./ModelPicker"

const OpenAiModelPicker: React.FC = () => {
	const { apiConfiguration } = useExtensionState()

	return (
		<ModelPicker
			defaultModelId={apiConfiguration?.openAiModelId || ""}
			modelsKey="openAiModels"
			configKey="openAiModelId"
			infoKey="openAiModelInfo"
			refreshMessageType="refreshOpenAiModels"
			refreshValues={{
				baseUrl: apiConfiguration?.openAiBaseUrl,
				apiKey: apiConfiguration?.openAiApiKey,
			}}
			serviceName="OpenAI"
			serviceUrl="https://platform.openai.com"
			recommendedModel="gpt-4-turbo-preview"
			allowCustomModel={true}
		/>
	)
}

export default OpenAiModelPicker
