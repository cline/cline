import { skaxDefaultModelId, skaxModels } from "@shared/skax-models"
import { Mode } from "@shared/storage/types"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface SkaxProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const SkaxProvider = ({ showModelOptions, isPopup, currentMode }: SkaxProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const selectedModelId =
		(currentMode === "plan" ? apiConfiguration?.planModeSkaxModelId : apiConfiguration?.actModeSkaxModelId) ||
		skaxDefaultModelId
	const selectedModelInfo =
		selectedModelId in skaxModels ? skaxModels[selectedModelId as keyof typeof skaxModels] : skaxModels[skaxDefaultModelId]

	return (
		<div>
			<BaseUrlField
				initialValue={apiConfiguration?.skaxBaseUrl || "https://guest-api.sktax.chat/v1"}
				label={t("providers.baseUrl")}
				onChange={(value) => handleFieldChange("skaxBaseUrl", value)}
				placeholder="https://guest-api.sktax.chat/v1"
			/>

			<ApiKeyField
				initialValue={apiConfiguration?.skaxApiKey || ""}
				onChange={(value) => handleFieldChange("skaxApiKey", value)}
				providerName="SKAX"
			/>

			<DebouncedTextField
				initialValue={selectedModelId || "ax4"}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeSkaxModelId", act: "actModeSkaxModelId" }, value, currentMode)
				}
				placeholder="ax4"
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>{t("providers.modelId")}</span>
			</DebouncedTextField>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
