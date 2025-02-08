import { ModelPicker } from "./ModelPicker"
import { openRouterDefaultModelId } from "../../../../src/shared/api"

export const OpenRouterModelPicker = () => (
	<ModelPicker
		defaultModelId={openRouterDefaultModelId}
		modelsKey="openRouterModels"
		configKey="openRouterModelId"
		infoKey="openRouterModelInfo"
		refreshMessageType="refreshOpenRouterModels"
		serviceName="OpenRouter"
		serviceUrl="https://openrouter.ai/models"
		recommendedModel="anthropic/claude-3.5-sonnet:beta"
	/>
)
