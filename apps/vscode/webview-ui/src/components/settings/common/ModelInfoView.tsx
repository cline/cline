import type { ModelInfo } from "@shared/api"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import styled from "styled-components"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"
import { formatPrice, hasThinkingBudget, supportsBrowserUse, supportsImages, supportsPromptCache } from "../utils/pricingUtils"

// ========== Styled Components ==========

const InfoRow = styled.div`
	display: flex;
	column-gap: 16px;
	row-gap: 4px;
	font-size: 12px;
	color: var(--vscode-foreground);
	margin-top: 8px;
	flex-wrap: wrap;
`

const InfoItem = styled.span`
	white-space: nowrap;
`

const InfoLabel = styled.span`
	color: var(--vscode-descriptionForeground);
`

const InfoValue = styled.span`
	font-weight: 500;
`

const CollapsibleHeader = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 12px;
	cursor: pointer;
	user-select: none;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--vscode-descriptionForeground);

	&:hover {
		color: var(--vscode-foreground);
	}
`

const CollapsibleArrow = styled.span<{ $isExpanded: boolean }>`
	font-size: 10px;
	transition: transform 0.15s ease;
	transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`

const CollapsibleContent = styled.div<{ $isExpanded: boolean }>`
	max-height: ${({ $isExpanded }) => ($isExpanded ? "800px" : "0")};
	overflow: ${({ $isExpanded }) => ($isExpanded ? "visible" : "hidden")};
	transition: max-height 0.2s ease;
`

const AdvancedSection = styled.div`
	padding-top: 8px;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const AdvancedRow = styled.div`
	display: flex;
	justify-content: space-between;
	padding: 4px 0;
`

const AdvancedLabel = styled.span``

const AdvancedValue = styled.span`
	color: var(--vscode-foreground);
`

const ProviderRoutingContainer = styled.div`
	margin-top: 8px;
	margin-bottom: 8px;
`

const ProviderRoutingLabel = styled.label`
	display: block;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 4px;
`

// ========== Helper Functions ==========

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Format price for compact display (e.g., "$5/M" for $5 per million tokens)
 * Price is already in per-million format from OpenRouter
 */
const formatCompactPrice = (price: number | undefined, t: Translate): string => {
	if (price === undefined) {
		return t("settings:modelInfo.notAvailable")
	}
	if (price === 0) {
		return t("settings:modelInfo.free")
	}
	if (price < 0.01) {
		return `$${price.toFixed(4)}/M`
	}
	if (price < 1) {
		return `$${price.toFixed(2)}/M`
	}
	return `$${price % 1 === 0 ? price : price.toFixed(2)}/M`
}

/**
 * Format context window for compact display (e.g., "200K")
 */
const formatCompactContext = (contextWindow: number | undefined, t: Translate): string => {
	if (!contextWindow) {
		return t("settings:modelInfo.notAvailable")
	}
	if (contextWindow >= 1_000_000) {
		return `${(contextWindow / 1_000_000).toFixed(contextWindow % 1_000_000 === 0 ? 0 : 1)}M`
	}
	return `${Math.round(contextWindow / 1000)}K`
}

/**
 * Returns an array of formatted tier strings
 */
const formatTiers = (
	tiers: ModelInfo["tiers"],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
	t: Translate,
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

			const isUnbounded = tier.contextWindow === Number.POSITIVE_INFINITY || tier.contextWindow >= Number.MAX_SAFE_INTEGER

			return (
				<span key={`tier-${tier.contextWindow}`} style={{ paddingLeft: "15px" }}>
					{isUnbounded
						? t("settings:modelInfo.tierAbove", {
								limit: prevLimit.toLocaleString(),
								price: formatPrice(price),
							})
						: t("settings:modelInfo.tierUpTo", {
								limit: tier.contextWindow?.toLocaleString(),
								price: formatPrice(price),
							})}
					{index < arr.length - 1 && <br />}
				</span>
			)
		})
		.filter((element): element is JSX.Element => element !== null)
}

// ========== Props ==========

interface ModelInfoViewProps {
	selectedModelId: string
	modelInfo: ModelInfo
	isPopup?: boolean
	// Provider routing props (optional - only shown for Cline provider)
	providerSorting?: string
	onProviderSortingChange?: (value: string) => void
	showProviderRouting?: boolean
	/**
	 * Suppress the per-token pricing display (compact input/output row, cache
	 * pricing in Advanced, and tiered pricing). Set this for providers whose
	 * billing is subscription-based or otherwise not per-token — any
	 * `ProviderInfo.metadata.usageCostDisplay` other than `"show"` (see
	 * `resolveProviderUsageCostDisplay` in `@cline/llms`).
	 */
	hideUsageCost?: boolean
}

// ========== Component ==========

export const ModelInfoView = ({
	selectedModelId,
	modelInfo,
	isPopup,
	providerSorting,
	onProviderSortingChange,
	showProviderRouting,
	hideUsageCost,
}: ModelInfoViewProps) => {
	const { t } = useTranslation()
	const [advancedExpanded, setAdvancedExpanded] = useState(false)

	const { models: geminiModels } = useProviderModels("gemini")
	const isGemini = Object.hasOwn(geminiModels, selectedModelId)
	const hasThinkingConfig = hasThinkingBudget(modelInfo)
	const hasTiers = !!modelInfo.tiers && modelInfo.tiers.length > 0

	// Capability checks
	const hasImages = supportsImages(modelInfo)
	const hasBrowser = supportsBrowserUse(modelInfo)
	const hasCaching = !isGemini && supportsPromptCache(modelInfo)

	// Check if we have cache pricing to show in Advanced section
	const hasCachePricing = modelInfo.supportsPromptCache && (modelInfo.cacheWritesPrice || modelInfo.cacheReadsPrice)

	return (
		<div style={{ marginTop: 4 }}>
			{/* Description */}
			{modelInfo.description && (
				<ModelDescriptionMarkdown isPopup={isPopup} key="description" markdown={modelInfo.description} />
			)}

			{/* Compact Info Row: Context, Input, Output */}
			<InfoRow>
				{modelInfo.contextWindow !== undefined && modelInfo.contextWindow > 0 && (
					<InfoItem>
						<InfoLabel>{t("settings:modelInfo.context")} </InfoLabel>
						<InfoValue>{formatCompactContext(modelInfo.contextWindow, t)}</InfoValue>
					</InfoItem>
				)}
				{!hideUsageCost && modelInfo.inputPrice !== undefined && (
					<InfoItem>
						<InfoLabel>{t("settings:modelInfo.input")} </InfoLabel>
						<InfoValue>{formatCompactPrice(modelInfo.inputPrice, t)}</InfoValue>
					</InfoItem>
				)}
				{!hideUsageCost && modelInfo.outputPrice !== undefined && (
					<InfoItem>
						<InfoLabel>{t("settings:modelInfo.output")} </InfoLabel>
						<InfoValue>
							{hasThinkingConfig && modelInfo.thinkingConfig?.outputPrice !== undefined
								? formatCompactPrice(modelInfo.thinkingConfig.outputPrice, t)
								: formatCompactPrice(modelInfo.outputPrice, t)}
						</InfoValue>
					</InfoItem>
				)}
			</InfoRow>

			{/* Collapsible Advanced Section */}
			<CollapsibleHeader onClick={() => setAdvancedExpanded(!advancedExpanded)}>
				<CollapsibleArrow $isExpanded={advancedExpanded}>▶</CollapsibleArrow>
				{t("settings:modelInfo.advanced")}
			</CollapsibleHeader>
			<CollapsibleContent $isExpanded={advancedExpanded}>
				<AdvancedSection>
					{/* Capabilities */}
					<AdvancedRow>
						<AdvancedLabel>{t("settings:modelInfo.images")}</AdvancedLabel>
						<AdvancedValue>{hasImages ? t("settings:modelInfo.yes") : t("settings:modelInfo.no")}</AdvancedValue>
					</AdvancedRow>
					<AdvancedRow>
						<AdvancedLabel>{t("settings:modelInfo.browser")}</AdvancedLabel>
						<AdvancedValue>{hasBrowser ? t("settings:modelInfo.yes") : t("settings:modelInfo.no")}</AdvancedValue>
					</AdvancedRow>
					{!isGemini && (
						<AdvancedRow>
							<AdvancedLabel>{t("settings:modelInfo.promptCaching")}</AdvancedLabel>
							<AdvancedValue>{hasCaching ? t("settings:modelInfo.yes") : t("settings:modelInfo.no")}</AdvancedValue>
						</AdvancedRow>
					)}

					{/* Cache Pricing */}
					{!hideUsageCost && hasCachePricing && (
						<>
							{modelInfo.cacheReadsPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>{t("settings:modelInfo.cacheReads")}</AdvancedLabel>
									<AdvancedValue>{formatCompactPrice(modelInfo.cacheReadsPrice, t)}</AdvancedValue>
								</AdvancedRow>
							)}
							{modelInfo.cacheWritesPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>{t("settings:modelInfo.cacheWrites")}</AdvancedLabel>
									<AdvancedValue>{formatCompactPrice(modelInfo.cacheWritesPrice, t)}</AdvancedValue>
								</AdvancedRow>
							)}
						</>
					)}

					{/* Tiered Pricing */}
					{!hideUsageCost && hasTiers && (
						<div style={{ marginTop: 8 }}>
							<div style={{ fontWeight: 500, marginBottom: 4 }}>{t("settings:modelInfo.tieredPricing")}</div>
							{modelInfo.tiers && (
								<>
									<div>
										<span style={{ fontWeight: 500 }}>{t("settings:modelInfo.input")}</span>
										<br />
										{formatTiers(modelInfo.tiers, "inputPrice", t)}
									</div>
									<div style={{ marginTop: 4 }}>
										<span style={{ fontWeight: 500 }}>{t("settings:modelInfo.output")}</span>
										<br />
										{formatTiers(modelInfo.tiers, "outputPrice", t)}
									</div>
								</>
							)}
						</div>
					)}

					{/* Provider Routing */}
					{showProviderRouting && onProviderSortingChange && (
						<ProviderRoutingContainer>
							<ProviderRoutingLabel>{t("settings:modelInfo.providerRouting.label")}</ProviderRoutingLabel>
							<VSCodeDropdown
								onChange={(e: any) => onProviderSortingChange(e.target.value)}
								style={{ width: "100%" }}
								value={providerSorting || ""}>
								<VSCodeOption value="">{t("settings:modelInfo.providerRouting.default")}</VSCodeOption>
								<VSCodeOption value="price">{t("settings:modelInfo.providerRouting.price")}</VSCodeOption>
								<VSCodeOption value="throughput">
									{t("settings:modelInfo.providerRouting.throughput")}
								</VSCodeOption>
								<VSCodeOption value="latency">{t("settings:modelInfo.providerRouting.latency")}</VSCodeOption>
							</VSCodeDropdown>
							<p
								style={{
									fontSize: "11px",
									marginTop: 4,
									marginBottom: 0,
									color: "var(--vscode-descriptionForeground)",
								}}>
								{!providerSorting && t("settings:modelInfo.providerRouting.defaultDescription")}
								{providerSorting === "price" && t("settings:modelInfo.providerRouting.priceDescription")}
								{providerSorting === "throughput" &&
									t("settings:modelInfo.providerRouting.throughputDescription")}
								{providerSorting === "latency" && t("settings:modelInfo.providerRouting.latencyDescription")}
							</p>
						</ProviderRoutingContainer>
					)}
				</AdvancedSection>
			</CollapsibleContent>
		</div>
	)
}
