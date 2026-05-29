import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface HuaweiCloudMaasProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const HuaweiCloudMaasProvider = ({ showModelOptions, isPopup, currentMode }: HuaweiCloudMaasProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const savedHuaweiCloudMaasModelId =
		currentMode === "plan"
			? apiConfiguration?.planModeHuaweiCloudMaasModelId
			: apiConfiguration?.actModeHuaweiCloudMaasModelId
	const { models, selectedModelId, selectedModelInfo, hideUsageCost } = useStaticProviderSelection(
		"huawei-cloud-maas",
		apiConfiguration,
		currentMode,
		{ savedModelId: savedHuaweiCloudMaasModelId },
	)

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
						models={models}
						onChange={(e: any) => {
							const modelId = e.target.value
							const modelInfo = models[modelId]
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
					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
