import { ModelPicker } from "./ModelPicker"
import { glamaDefaultModelId } from "../../../../src/shared/api"

export const GlamaModelPicker = () => (
	<ModelPicker
		defaultModelId={glamaDefaultModelId}
		modelsKey="glamaModels"
		configKey="glamaModelId"
		infoKey="glamaModelInfo"
		refreshMessageType="refreshGlamaModels"
		serviceName="Glama"
		serviceUrl="https://glama.ai/models"
		recommendedModel="anthropic/claude-3-5-sonnet"
	/>
)
