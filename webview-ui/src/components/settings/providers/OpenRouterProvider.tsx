import { EmptyRequest } from "@shared/proto/cline/common"
import type { ProviderListItem } from "@shared/proto/cline/models"
import { UpdateSdkProviderSettingsRequest } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient, ModelsServiceClient } from "@/services/grpc-client"
import { useOpenRouterKeyInfo } from "../../ui/hooks/useOpenRouterKeyInfo"
import { DropdownContainer } from "../common/ModelSelector"
import OpenRouterModelPicker from "../OpenRouterModelPicker"
import { formatPrice } from "../utils/pricingUtils"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Component to display OpenRouter balance information
 */
const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>Loading...</span>
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
			title={`Remaining balance: ${formattedBalance}\nLimit: ${formatPrice(keyInfo.limit)}\nUsage: ${formatPrice(keyInfo.usage)}`}>
			Balance: {formattedBalance}
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
	provider?: ProviderListItem
}

/**
 * The OpenRouter provider configuration component
 */
export const OpenRouterProvider = ({ showModelOptions, isPopup, currentMode, provider }: OpenRouterProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedModelId = modeFields.openRouterModelId || modeFields.apiModelId || provider?.defaultModelId || ""
	const apiKey = apiConfiguration?.openRouterApiKey ?? provider?.apiKey ?? ""

	const saveSettings = (updates: Partial<UpdateSdkProviderSettingsRequest>) => {
		ModelsServiceClient.updateSdkProviderSettings(
			UpdateSdkProviderSettingsRequest.create({
				providerId: "openrouter",
				mode: currentMode,
				modelId: selectedModelId || undefined,
				enabled: true,
				...updates,
			}),
		).catch((error) => {
			console.error("Failed to update OpenRouter SDK provider settings:", error)
		})
	}

	const [localApiKey, setLocalApiKey] = useState(apiKey)
	useEffect(() => {
		setLocalApiKey(apiKey)
	}, [apiKey])

	const [baseUrl, setBaseUrl] = useDebouncedInput(provider?.baseUrl || "", (value) => {
		saveSettings({ baseUrl: value || undefined })
	})

	return (
		<div>
			<div>
				<VSCodeTextField
					onInput={(e: any) => {
						const value = e.target.value
						setLocalApiKey(value)
						saveSettings({ apiKey: value || undefined })
					}}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password"
					value={localApiKey}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
						<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
						{localApiKey && <OpenRouterBalanceDisplay apiKey={localApiKey} />}
					</div>
				</VSCodeTextField>
				{!localApiKey && (
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
						Get OpenRouter API Key
					</VSCodeButton>
				)}
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension.
				</p>
			</div>

			<DropdownContainer className="dropdown-container">
				<VSCodeTextField
					onInput={(e: any) => setBaseUrl(e.target.value)}
					placeholder="Provider default"
					style={{ width: "100%" }}
					value={baseUrl}>
					<span style={{ fontWeight: 500 }}>Base URL</span>
				</VSCodeTextField>
				<p className="text-xs mt-[3px] text-(--vscode-descriptionForeground)">
					{provider?.baseUrlDescription || "The base endpoint to use for OpenRouter requests."}
				</p>
			</DropdownContainer>

			{showModelOptions && <OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />}
		</div>
	)
}
