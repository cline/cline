import { huaweiCloudMaasModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
						label="Model"
						models={huaweiCloudMaasModels}
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
						selectedModelId={selectedModelId}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
