import { geminiModels, ModelInfo } from "@shared/api"
import { Fragment, useState } from "react"
import { useTranslation } from "react-i18next"
import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"
import {
	formatPrice,
	formatTokenLimit,
	formatTokenPrice,
	hasThinkingBudget,
	supportsBrowserUse,
	supportsImages,
	supportsPromptCache,
} from "../utils/pricingUtils"

/**
 * Returns an array of formatted tier strings
 */
const formatTiers = (
	tiers: ModelInfo["tiers"],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
	t: (key: string, options?: any) => string,
): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}

	return tiers
		.map((tier, index, arr) => {
			const prevLimit = index > 0 ? arr[index - 1].contextWindow : 0
			const price = tier[priceType]

			if (price === undefined) {
				return null
			}

			return (
				<span key={index} style={{ paddingLeft: "15px" }}>
					{formatPrice(price)}/{t("api_provider.common.model_info.million_tokens")} (
					{tier.contextWindow === Number.POSITIVE_INFINITY || tier.contextWindow >= Number.MAX_SAFE_INTEGER ? (
						<span>
							{t("api_provider.common.model_info.greater_than")} {prevLimit.toLocaleString()}
						</span>
					) : (
						<span>
							{t("api_provider.common.model_info.less_than_or_equal")} {tier.contextWindow?.toLocaleString()}
						</span>
					)}{" "}
					{t("api_provider.common.model_info.tokens")}
					{index < arr.length - 1 && <br />}
				</span>
			)
		})
		.filter((element): element is JSX.Element => element !== null)
}

/**
 * Props for the ModelInfoSupportsItem component
 */
interface ModelInfoSupportsItemProps {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}

/**
 * A component to show a feature support indicator with an icon
 */
const ModelInfoSupportsItem = ({ isSupported, supportsLabel, doesNotSupportLabel }: ModelInfoSupportsItemProps) => (
	<span
		style={{
			fontWeight: 500,
			color: isSupported ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)",
		}}>
		<i
			className={`codicon codicon-${isSupported ? "check" : "x"}`}
			style={{
				marginRight: 4,
				marginBottom: isSupported ? 1 : -1,
				fontSize: isSupported ? 11 : 13,
				fontWeight: 700,
				display: "inline-block",
				verticalAlign: "bottom",
			}}></i>
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</span>
)

/**
 * Props for the ModelInfoView component
 */
interface ModelInfoViewProps {
	selectedModelId: string
	modelInfo: ModelInfo
	isPopup?: boolean
}

/**
 * A reusable component for displaying model information
 * This component manages its own description expansion state
 */
export const ModelInfoView = ({ selectedModelId, modelInfo, isPopup }: ModelInfoViewProps) => {
	const { t } = useTranslation("common")

	// Internal state management for description expansion
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const isGemini = Object.keys(geminiModels).includes(selectedModelId)
	const hasThinkingConfig = hasThinkingBudget(modelInfo)
	const hasTiers = !!modelInfo.tiers && modelInfo.tiers.length > 0

	// Create elements for input pricing
	const inputPriceElement = hasTiers ? (
		<Fragment key="inputPriceTiers">
			<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.input_price")}:</span>
			<br />
			{formatTiers(modelInfo.tiers, "inputPrice", t)}
		</Fragment>
	) : modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 ? (
		<span key="inputPrice">
			<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.input_price")}:</span>{" "}
			{formatTokenPrice(modelInfo.inputPrice)}
		</span>
	) : null

	// --- Output Price Logic ---
	let outputPriceElement = null
	if (hasThinkingConfig && modelInfo.outputPrice !== undefined && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		// Display both standard and thinking budget prices
		outputPriceElement = (
			<Fragment key="outputPriceConditional">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.output_price_standard")}:</span>{" "}
				{formatTokenPrice(modelInfo.outputPrice)}
				<br />
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.output_price_thinking")}:</span>{" "}
				{formatTokenPrice(modelInfo.thinkingConfig.outputPrice)}
			</Fragment>
		)
	} else if (hasTiers) {
		// Display tiered output pricing
		outputPriceElement = (
			<Fragment key="outputPriceTiers">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.output_price")}:</span>
				<span style={{ fontStyle: "italic" }}> {t("api_provider.common.model_info.based_on_input_tokens")}</span>
				<br />
				{formatTiers(modelInfo.tiers, "outputPrice", t)}
			</Fragment>
		)
	} else if (modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0) {
		// Display single standard output price
		outputPriceElement = (
			<span key="outputPrice">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.output_price")}:</span>{" "}
				{formatTokenPrice(modelInfo.outputPrice)}
			</span>
		)
	}
	// --- End Output Price Logic ---

	const infoItems = [
		modelInfo.description && (
			<ModelDescriptionMarkdown isPopup={isPopup} key="description" markdown={modelInfo.description} />
		),
		<ModelInfoSupportsItem
			doesNotSupportLabel={t("api_provider.common.model_info.does_not_support_images")}
			isSupported={supportsImages(modelInfo)}
			key="supportsImages"
			supportsLabel={t("api_provider.common.model_info.supports_images")}
		/>,
		<ModelInfoSupportsItem
			doesNotSupportLabel={t("api_provider.common.model_info.does_not_support_browser_use")}
			isSupported={supportsBrowserUse(modelInfo)}
			key="supportsBrowserUse"
			supportsLabel={t("api_provider.common.model_info.supports_browser_use")}
		/>,
		!isGemini && (
			<ModelInfoSupportsItem
				doesNotSupportLabel={t("api_provider.common.model_info.does_not_support_prompt_caching")}
				isSupported={supportsPromptCache(modelInfo)}
				key="supportsPromptCache"
				supportsLabel={t("api_provider.common.model_info.supports_prompt_caching")}
			/>
		),
		modelInfo.contextWindow !== undefined && modelInfo.contextWindow > 0 && (
			<span key="contextWindow">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.context_window")}:</span>{" "}
				{formatTokenLimit(modelInfo.contextWindow)} {t("api_provider.common.model_info.tokens")}
			</span>
		),
		inputPriceElement, // Add the generated input price block
		modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<span key="cacheWritesPrice">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.cache_writes_price")}:</span>{" "}
				{formatTokenPrice(modelInfo.cacheWritesPrice || 0)}
			</span>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<span key="cacheReadsPrice">
				<span style={{ fontWeight: 500 }}>{t("api_provider.common.model_info.cache_reads_price")}:</span>{" "}
				{formatTokenPrice(modelInfo.cacheReadsPrice || 0)}
			</span>
		),
		outputPriceElement, // Add the generated output price block
	].filter(Boolean)

	return (
		<p
			style={{
				fontSize: "12px",
				marginTop: "2px",
				color: "var(--vscode-descriptionForeground)",
			}}>
			{infoItems.map((item, index) => (
				<Fragment key={index}>
					{item}
					{index < infoItems.length - 1 && <br />}
				</Fragment>
			))}
		</p>
	)
}
