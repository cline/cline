import { ModelPicker } from "./ModelPicker"
import { unboundDefaultModelId } from "../../../../src/shared/api"

export const UnboundModelPicker = () => (
	<ModelPicker
		defaultModelId={unboundDefaultModelId}
		modelsKey="unboundModels"
		configKey="unboundModelId"
		infoKey="unboundModelInfo"
		refreshMessageType="refreshUnboundModels"
		serviceName="Unbound"
		serviceUrl="https://api.getunbound.ai/models"
		recommendedModel={unboundDefaultModelId}
	/>
)
