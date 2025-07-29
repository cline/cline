import { huaweiCloudMaasModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelSelector } from "../common/ModelSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface HuaweiCloudMaasProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const HuaweiCloudMaasProvider = ({ showModelOptions, isPopup, currentMode }: HuaweiCloudMaasProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.huaweiCloudMaasApiKey || ""}
				onChange={(value) => handleFieldChange("huaweiCloudMaasApiKey", value)}
				providerName="Huawei Cloud MaaS"
				signupUrl="https://support.huaweicloud.com/intl/zh-cn/usermanual-maas/maas_01_0001.html"
			/>
			{showModelOptions && (
				<>
					<ModelSelector
						models={huaweiCloudMaasModels}
						selectedModelId={selectedModelId}
						onChange={(e: any) => {
							const modelId = e.target.value
							const modelInfo = huaweiCloudMaasModels[modelId as keyof typeof huaweiCloudMaasModels]
							handleModeFieldsChange(
								{
									apiModelId: { plan: "planModeApiModelId", act: "actModeApiModelId" },
									huaweiCloudMaaSModelId: {
										plan: "planModeHuaweiCloudMaasModelId",
										act: "actModeHuaweiCloudMaasModelId",
									},
									huaweiCloudMaaSModelInfo: {
										plan: "planModeHuaweiCloudMaasModelInfo",
										act: "actModeHuaweiCloudMaasModelInfo",
									},
								},
								{
									apiModelId: modelId,
									huaweiCloudMaaSModelId: modelId,
									huaweiCloudMaaSModelInfo: modelInfo,
								},
								currentMode,
							)
						}}
						label="Model"
					/>
					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
