import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Fragment, useState } from "react"
import { ModelInfo } from "@shared/api"
import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"
import {
	formatPrice,
	formatTokenLimit,
	hasThinkingBudget,
	supportsImages,
	supportsBrowserUse,
	supportsPromptCache,
	describeTieredPricing,
	formatTokenPrice,
} from "../utils/pricingUtils"

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
export const ModelInfoSupportsItem = ({ isSupported, supportsLabel, doesNotSupportLabel }: ModelInfoSupportsItemProps) => (
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
 */
export const ModelInfoView = ({ selectedModelId, modelInfo, isPopup }: ModelInfoViewProps) => {
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const isGemini = selectedModelId && selectedModelId.includes("gemini")

	// Create elements for each model information property
	const infoItems = [
		// Add model description if available
		modelInfo.description && (
			<ModelDescriptionMarkdown
				key="description"
				markdown={modelInfo.description}
				isExpanded={isDescriptionExpanded}
				setIsExpanded={setIsDescriptionExpanded}
				isPopup={isPopup}
			/>
		),

		// Add capability indicators
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

		!isGemini && (
			<ModelInfoSupportsItem
				key="supportsPromptCache"
				isSupported={supportsPromptCache(modelInfo)}
				supportsLabel="Supports prompt caching"
				doesNotSupportLabel="Does not support prompt caching"
			/>
		),

		// Add token information
		modelInfo.maxTokens !== undefined && modelInfo.maxTokens > 0 && (
			<span key="maxTokens">
				<span style={{ fontWeight: 500 }}>Max output:</span> {formatTokenLimit(modelInfo.maxTokens)} tokens
			</span>
		),

		// Add input price information
		modelInfo.inputPriceTiers ? (
			<Fragment key="inputPriceTiers">
				<span style={{ fontWeight: 500 }}>Input price:</span>
				<br />
				{describeTieredPricing(modelInfo.inputPriceTiers).map((tier, idx) => (
					<span key={idx} style={{ paddingLeft: "15px" }}>
						{tier}
						{idx < describeTieredPricing(modelInfo.inputPriceTiers).length - 1 && <br />}
					</span>
				))}
			</Fragment>
		) : (
			modelInfo.inputPrice !== undefined &&
			modelInfo.inputPrice > 0 && (
				<span key="inputPrice">
					<span style={{ fontWeight: 500 }}>Input price:</span> {formatTokenPrice(modelInfo.inputPrice)}
				</span>
			)
		),

		// Add cache pricing if relevant
		supportsPromptCache(modelInfo) && modelInfo.cacheWritesPrice && (
			<span key="cacheWritesPrice">
				<span style={{ fontWeight: 500 }}>Cache writes price:</span> {formatPrice(modelInfo.cacheWritesPrice)}
				/million tokens
			</span>
		),

		supportsPromptCache(modelInfo) && modelInfo.cacheReadsPrice && (
			<span key="cacheReadsPrice">
				<span style={{ fontWeight: 500 }}>Cache reads price:</span> {formatPrice(modelInfo.cacheReadsPrice)}/million
				tokens
			</span>
		),

		// Add output price information
		modelInfo.outputPriceTiers ? (
			<Fragment key="outputPriceTiers">
				<span style={{ fontWeight: 500 }}>Output price:</span>
				<span style={{ fontStyle: "italic" }}> (based on input tokens)</span>
				<br />
				{describeTieredPricing(modelInfo.outputPriceTiers).map((tier, idx) => (
					<span key={idx} style={{ paddingLeft: "15px" }}>
						{tier}
						{idx < describeTieredPricing(modelInfo.outputPriceTiers).length - 1 && <br />}
					</span>
				))}
			</Fragment>
		) : hasThinkingBudget(modelInfo) &&
		  modelInfo.outputPrice !== undefined &&
		  modelInfo.thinkingConfig?.outputPrice !== undefined ? (
			<Fragment key="outputPriceConditional">
				<span style={{ fontWeight: 500 }}>Output price (Standard):</span> {formatTokenPrice(modelInfo.outputPrice)}
				<br />
				<span style={{ fontWeight: 500 }}>Output price (Thinking Budget &gt; 0):</span>{" "}
				{formatTokenPrice(modelInfo.thinkingConfig.outputPrice)}
			</Fragment>
		) : (
			modelInfo.outputPrice !== undefined &&
			modelInfo.outputPrice > 0 && (
				<span key="outputPrice">
					<span style={{ fontWeight: 500 }}>Output price:</span> {formatTokenPrice(modelInfo.outputPrice)}
				</span>
			)
		),

		// Add provider-specific notes
		isGemini && (
			<span key="geminiInfo" style={{ fontStyle: "italic" }}>
				* Free up to {selectedModelId && selectedModelId.includes("flash") ? "15" : "2"} requests per minute. After that,
				billing depends on prompt size.{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" style={{ display: "inline", fontSize: "inherit" }}>
					For more info, see pricing details.
				</VSCodeLink>
			</span>
		),
	].filter(Boolean) // Remove any undefined/null items

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
