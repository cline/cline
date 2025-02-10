import { ModelPicker } from "./ModelPicker"
import { requestyDefaultModelId } from "../../../../src/shared/api"

export const RequestyModelPicker = () => (
	<ModelPicker
		defaultModelId={requestyDefaultModelId}
		modelsKey="requestyModels"
		configKey="requestyModelId"
		infoKey="requestyModelInfo"
		refreshMessageType="refreshRequestyModels"
		serviceName="Requesty"
		serviceUrl="https://requesty.ai"
		recommendedModel="anthropic/claude-3-5-sonnet-latest"
	/>
)
