import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { AccountServiceClient } from "@/services/grpc-client"
import { useOpenRouterKeyInfo } from "../../ui/hooks/useOpenRouterKeyInfo"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OpenRouterModelPicker from "../OpenRouterModelPicker"
import { formatPrice } from "../utils/pricingUtils"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Component to display OpenRouter balance information
 */
const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { t } = useTranslation()
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return (
			<span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
				{t("providers:shared.loading")}
			</span>
		)
	}

	if (error || !keyInfo || keyInfo.limit === null) {
		// Don't show anything if there's an error, no info, or no limit set
		return null
	}

	// Calculate remaining balance
	const remainingBalance = keyInfo.limit - keyInfo.usage
	const formattedBalance = formatPrice(remainingBalance)

	return (
		<VSCodeLink
			href="https://openrouter.ai/settings/keys"
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}
			title={t("providers:openrouter.balanceTitle", {
				balance: formattedBalance,
				limit: formatPrice(keyInfo.limit),
				usage: formatPrice(keyInfo.usage),
			})}>
			{t("providers:openrouter.balance", { balance: formattedBalance })}
		</VSCodeLink>
	)
}

/**
 * Props for the OpenRouterProvider component
 */
interface OpenRouterProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenRouter provider configuration component
 */
export const OpenRouterProvider = ({ showModelOptions, isPopup, currentMode }: OpenRouterProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { config, write } = useProviderConfig("openrouter")
	const [openRouterApiKey, setOpenRouterApiKey] = useState(apiConfiguration?.openRouterApiKey || "")
	const apiKeyLength = config?.apiKeyLength || apiConfiguration?.openRouterApiKey?.length
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength,
		onApiKeyChange: setOpenRouterApiKey,
		providerName: "OpenRouter",
		write,
	})

	useEffect(() => {
		setOpenRouterApiKey(apiConfiguration?.openRouterApiKey || "")
	}, [apiConfiguration?.openRouterApiKey])

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder={t("providers:shared.enterApiKeyPlaceholder")}
					style={{ width: "100%" }}
					type="password">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
						<span style={{ fontWeight: 500 }}>{t("providers:openrouter.apiKeyLabel")}</span>
						{openRouterApiKey && <OpenRouterBalanceDisplay apiKey={openRouterApiKey} />}
					</div>
				</DebouncedTextField>
				{!openRouterApiKey && (
					<VSCodeButton
						appearance="secondary"
						onClick={async () => {
							try {
								await AccountServiceClient.openrouterAuthClicked(EmptyRequest.create())
							} catch (error) {
								console.error("Failed to open OpenRouter auth:", error)
							}
						}}
						style={{ margin: "5px 0 0 0" }}>
						{t("providers:openrouter.getApiKeyButton")}
					</VSCodeButton>
				)}
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("providers:shared.apiKeyStoredLocally")}
				</p>
			</div>

			{showModelOptions && <OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />}
		</div>
	)
}
