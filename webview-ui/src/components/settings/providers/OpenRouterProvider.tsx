import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { useOpenRouterKeyInfo } from "../../ui/hooks/useOpenRouterKeyInfo"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { DropdownContainer } from "../common/ModelSelector"
import OpenRouterModelPicker, { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../OpenRouterModelPicker"
import { formatPrice } from "../utils/pricingUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Component to display OpenRouter balance information
 */
const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)
	const { t } = useTranslation("common")

	if (isLoading) {
		return (
			<span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
				{t("api_provider.openrouter.loading")}
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
			title={`${t("api_provider.openrouter.remaining_balance")}: ${formattedBalance}\n${t("api_provider.openrouter.limit")}: ${formatPrice(keyInfo.limit)}\n${t("api_provider.openrouter.usage")}: ${formatPrice(keyInfo.usage)}`}>
			{t("api_provider.openrouter.balance")}: {formattedBalance}
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
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { t } = useTranslation("common")

	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.openRouterProviderSorting)

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.openRouterApiKey || ""}
					onChange={(value) => handleFieldChange("openRouterApiKey", value)}
					placeholder={t("api_provider.common.api_key_placeholder")}
					style={{ width: "100%" }}
					type="password">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
						<span style={{ fontWeight: 500 }}>{t("api_provider.openrouter.api_key_label")}</span>
						{apiConfiguration?.openRouterApiKey && (
							<OpenRouterBalanceDisplay apiKey={apiConfiguration.openRouterApiKey} />
						)}
					</div>
				</DebouncedTextField>
				{!apiConfiguration?.openRouterApiKey && (
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
						{t("api_provider.openrouter.get_api_key")}
					</VSCodeButton>
				)}
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("api_provider.common.api_key_help_text")}
				</p>
			</div>

			{showModelOptions && (
				<>
					<VSCodeCheckbox
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								handleFieldChange("openRouterProviderSorting", "")
							}
						}}
						style={{ marginTop: -10 }}>
						{t("api_provider.cline.sort_provider_routing_label")}
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									onChange={(e: any) => {
										handleFieldChange("openRouterProviderSorting", e.target.value)
									}}
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.openRouterProviderSorting}>
									<VSCodeOption value="">
										{t("api_provider.cline.provider_sorting_options.default")}
									</VSCodeOption>
									<VSCodeOption value="price">
										{t("api_provider.cline.provider_sorting_options.price")}
									</VSCodeOption>
									<VSCodeOption value="throughput">
										{t("api_provider.cline.provider_sorting_options.throughput")}
									</VSCodeOption>
									<VSCodeOption value="latency">
										{t("api_provider.cline.provider_sorting_options.latency")}
									</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.openRouterProviderSorting &&
									t("api_provider.cline.provider_sorting_descriptions.default")}
								{apiConfiguration?.openRouterProviderSorting === "price" &&
									t("api_provider.cline.provider_sorting_descriptions.price")}
								{apiConfiguration?.openRouterProviderSorting === "throughput" &&
									t("api_provider.cline.provider_sorting_descriptions.throughput")}
								{apiConfiguration?.openRouterProviderSorting === "latency" &&
									t("api_provider.cline.provider_sorting_descriptions.latency")}
							</p>
						</div>
					)}

					<OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
