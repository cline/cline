import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Fragment, useState } from "react"
import { ModelInfo, geminiModels } from "@shared/api"
import { ModelDescriptionMarkdown } from "../OpenRouterModelPicker"
import {
	formatPrice,
	hasThinkingBudget,
	supportsImages,
	supportsBrowserUse,
	supportsPromptCache,
	formatTokenPrice,
	formatTokenLimit,
} from "../utils/pricingUtils"

/**
 * Returns an array of formatted tier strings
 */
const formatTiers = (
	tiers: ModelInfo["tiers"],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}

	return tiers
		.map((tier, index, arr) => {
			const prevLimit = index > 0 ? arr[index - 1].contextWindow : 0
			const price = tier[priceType]

			if (price === undefined) return null

			return (
				<span style={{ paddingLeft: "15px" }} key={index}>
					{formatPrice(price)}/million tokens (
					{tier.contextWindow === Number.POSITIVE_INFINITY ? (
						<span>
							{">"} {prevLimit.toLocaleString()}
						</span>
					) : (
						<span>
							{"<="} {tier.contextWindow.toLocaleString()}
						</span>
					)}
					{" tokens)"}
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
	// Internal state management for description expansion
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const isGeminiProvider = Object.keys(geminiModels).includes(selectedModelId)
	const hasThinkingConfig = hasThinkingBudget(modelInfo)
	const hasTiers = !!modelInfo.tiers && modelInfo.tiers.length > 0

	// Create elements for input pricing
	const inputPriceElement = hasTiers ? (
		<Fragment key="inputPriceTiers">
			<span style={{ fontWeight: 500 }}>Input price:</span>
			<br />
			{formatTiers(modelInfo.tiers, "inputPrice")}
		</Fragment>
	) : modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 ? (
		<span key="inputPrice">
			<span style={{ fontWeight: 500 }}>Input price:</span> {formatTokenPrice(modelInfo.inputPrice)}
		</span>
	) : null

	// --- Output Price Logic ---
	let outputPriceElement = null
	if (hasThinkingConfig && modelInfo.outputPrice !== undefined && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		// Display both standard and thinking budget prices
		outputPriceElement = (
			<Fragment key="outputPriceConditional">
				<span style={{ fontWeight: 500 }}>Output price (Standard):</span> {formatTokenPrice(modelInfo.outputPrice)}
				<br />
				<span style={{ fontWeight: 500 }}>Output price (Thinking Budget &gt; 0):</span>{" "}
				{formatTokenPrice(modelInfo.thinkingConfig.outputPrice)}
			</Fragment>
		)
	} else if (hasTiers) {
		// Display tiered output pricing
		outputPriceElement = (
			<Fragment key="outputPriceTiers">
				<span style={{ fontWeight: 500 }}>Output price:</span>
				<span style={{ fontStyle: "italic" }}> (based on input tokens)</span>
				<br />
				{formatTiers(modelInfo.tiers, "outputPrice")}
			</Fragment>
		)
	} else if (modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0) {
		// Display single standard output price
		outputPriceElement = (
			<span key="outputPrice">
				<span style={{ fontWeight: 500 }}>Output price:</span> {formatTokenPrice(modelInfo.outputPrice)}
			</span>
		)
	}
	// --- End Output Price Logic ---

	const infoItems = [
		modelInfo.description && (
			<ModelDescriptionMarkdown
				key="description"
				markdown={modelInfo.description}
				isExpanded={isDescriptionExpanded}
				setIsExpanded={setIsDescriptionExpanded}
				isPopup={isPopup}
			/>
		),
		<ModelInfoSupportsItem
			key="supportsImages"
			isSupported={supportsImages(modelInfo)}
			supportsLabel="Supports images"
			doesNotSupportLabel="Does not support images"
		/>,
		<ModelInfoSupportsItem
			key="supportsBrowserUse"
			isSupported={supportsBrowserUse(modelInfo)}
			supportsLabel="Supports browser use"
			doesNotSupportLabel="Does not support browser use"
		/>,
		!isGeminiProvider && (
			<ModelInfoSupportsItem
				key="supportsPromptCache"
				isSupported={supportsPromptCache(modelInfo)}
				supportsLabel="Supports prompt caching"
				doesNotSupportLabel="Does not support prompt caching"
			/>
		),
		modelInfo.maxTokens !== undefined && modelInfo.maxTokens > 0 && (
			<span key="maxTokens">
				<span style={{ fontWeight: 500 }}>Max output:</span> {formatTokenLimit(modelInfo.maxTokens)} tokens
			</span>
		),
		inputPriceElement, // Add the generated input price block
		modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<span key="cacheWritesPrice">
				<span style={{ fontWeight: 500 }}>Cache writes price:</span> {formatTokenPrice(modelInfo.cacheWritesPrice || 0)}
			</span>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<span key="cacheReadsPrice">
				<span style={{ fontWeight: 500 }}>Cache reads price:</span> {formatTokenPrice(modelInfo.cacheReadsPrice || 0)}
			</span>
		),
		outputPriceElement, // Add the generated output price block
		isGeminiProvider && (
			<span key="geminiInfo" style={{ fontStyle: "italic" }}>
				* Free up to {selectedModelId && selectedModelId.includes("flash") ? "15" : "2"} requests per minute. After that,
				billing depends on prompt size.{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" style={{ display: "inline", fontSize: "inherit" }}>
					For more info, see pricing details.
				</VSCodeLink>
			</span>
		),
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
