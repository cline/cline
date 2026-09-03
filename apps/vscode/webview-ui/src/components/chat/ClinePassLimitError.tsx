import type { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

interface ClinePassLimitErrorProps {
	message: string
}

const CLINE_PROVIDER_ID = "cline"

const getProviderSwitchConfig = (apiConfiguration: ApiConfiguration): ApiConfiguration => {
	return {
		...apiConfiguration,
		planModeApiProvider: CLINE_PROVIDER_ID,
		actModeApiProvider: CLINE_PROVIDER_ID,
	}
}

const ClinePassLimitError = ({ message }: ClinePassLimitErrorProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const [isSwitching, setIsSwitching] = useState(false)
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToUsageBasedBilling = async () => {
		setIsSwitching(true)
		setError(undefined)
		try {
			const protoConfig = convertApiConfigurationToProto(getProviderSwitchConfig(apiConfiguration ?? {}))
			await ModelsServiceClient.updateApiConfigurationProto(
				UpdateApiConfigurationRequest.create({
					apiConfiguration: protoConfig,
				}),
			)
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to Cline usage-based billing:", error)
			setError(t("chat:errors.clinePassLimit.switchFailed"))
		} finally {
			setIsSwitching(false)
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="cline-pass-limit-error">
			<div className="text-error mb-2">{t("chat:errors.clinePassLimit.title")}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">{message}</div>
			<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
				{t("chat:errors.clinePassLimit.switchPrompt")}
			</div>
			<VSCodeButton
				appearance="primary"
				className="w-full mt-3"
				disabled={isSwitching || didSwitch}
				onClick={handleSwitchToUsageBasedBilling}>
				{isSwitching
					? t("chat:errors.billing.switching")
					: didSwitch
						? t("chat:errors.billing.switchedToUsageBased")
						: t("chat:errors.billing.switchToUsageBased")}
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">
					{t("chat:errors.billing.retryAfterSwitching")}
				</div>
			)}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export default ClinePassLimitError
