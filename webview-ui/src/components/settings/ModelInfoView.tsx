import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { ModelInfo } from "@roo-code/types"

import { formatPrice } from "@src/utils/formatPrice"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelDescriptionMarkdown } from "./ModelDescriptionMarkdown"

type ModelInfoViewProps = {
	apiProvider?: string
	selectedModelId: string
	modelInfo?: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (isExpanded: boolean) => void
}

export const ModelInfoView = ({
	apiProvider,
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
}: ModelInfoViewProps) => {
	const { t } = useAppTranslation()

	// Show tiered pricing table for OpenAI Native when model supports non-standard tiers
	const allowedTierNames =
		modelInfo?.tiers?.filter((t) => t.name === "flex" || t.name === "priority")?.map((t) => t.name) ?? []
	const shouldShowTierPricingTable = apiProvider === "openai-native" && allowedTierNames.length > 0
	const fmt = (n?: number) => (typeof n === "number" ? `${formatPrice(n)}` : "—")

	const baseInfoItems = [
		typeof modelInfo?.contextWindow === "number" && modelInfo.contextWindow > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.contextWindow")}</span>{" "}
				{modelInfo.contextWindow?.toLocaleString()} tokens
			</>
		),
		typeof modelInfo?.maxTokens === "number" && modelInfo.maxTokens > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.maxOutput")}:</span>{" "}
				{modelInfo.maxTokens?.toLocaleString()} tokens
			</>
		),
		<ModelInfoSupportsItem
			isSupported={modelInfo?.supportsImages ?? false}
			supportsLabel={t("settings:modelInfo.supportsImages")}
			doesNotSupportLabel={t("settings:modelInfo.noImages")}
		/>,
		<ModelInfoSupportsItem
			isSupported={modelInfo?.supportsComputerUse ?? false}
			supportsLabel={t("settings:modelInfo.supportsComputerUse")}
			doesNotSupportLabel={t("settings:modelInfo.noComputerUse")}
		/>,
		<ModelInfoSupportsItem
			isSupported={modelInfo?.supportsPromptCache ?? false}
			supportsLabel={t("settings:modelInfo.supportsPromptCache")}
			doesNotSupportLabel={t("settings:modelInfo.noPromptCache")}
		/>,
		apiProvider === "gemini" && (
			<span className="italic">
				{selectedModelId.includes("pro-preview")
					? t("settings:modelInfo.gemini.billingEstimate")
					: t("settings:modelInfo.gemini.freeRequests", {
							count: selectedModelId && selectedModelId.includes("flash") ? 15 : 2,
						})}{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" className="text-sm">
					{t("settings:modelInfo.gemini.pricingDetails")}
				</VSCodeLink>
			</span>
		),
	].filter(Boolean)

	const priceInfoItems = [
		modelInfo?.inputPrice !== undefined && modelInfo.inputPrice > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.inputPrice")}:</span>{" "}
				{formatPrice(modelInfo.inputPrice)} / 1M tokens
			</>
		),
		modelInfo?.outputPrice !== undefined && modelInfo.outputPrice > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.outputPrice")}:</span>{" "}
				{formatPrice(modelInfo.outputPrice)} / 1M tokens
			</>
		),
		modelInfo?.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<>
				<span className="font-medium">{t("settings:modelInfo.cacheReadsPrice")}:</span>{" "}
				{formatPrice(modelInfo.cacheReadsPrice || 0)} / 1M tokens
			</>
		),
		modelInfo?.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<>
				<span className="font-medium">{t("settings:modelInfo.cacheWritesPrice")}:</span>{" "}
				{formatPrice(modelInfo.cacheWritesPrice || 0)} / 1M tokens
			</>
		),
	].filter(Boolean)

	const infoItems = shouldShowTierPricingTable ? baseInfoItems : [...baseInfoItems, ...priceInfoItems]

	return (
		<>
			{modelInfo?.description && (
				<ModelDescriptionMarkdown
					key="description"
					markdown={modelInfo.description}
					isExpanded={isDescriptionExpanded}
					setIsExpanded={setIsDescriptionExpanded}
				/>
			)}
			<div className="text-sm text-vscode-descriptionForeground">
				{infoItems.map((item, index) => (
					<div key={index}>{item}</div>
				))}
			</div>

			{shouldShowTierPricingTable && (
				<div className="mt-2">
					<div className="text-xs text-vscode-descriptionForeground mb-1">
						{t("settings:serviceTier.pricingTableTitle")}
					</div>
					<div className="border border-vscode-dropdown-border rounded-xs overflow-hidden">
						<table className="w-full text-sm">
							<thead className="bg-vscode-dropdown-background">
								<tr>
									<th className="text-left px-3 py-1.5">{t("settings:serviceTier.columns.tier")}</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.input")}
									</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.output")}
									</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.cacheReads")}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr className="border-t border-vscode-dropdown-border/60">
									<td className="px-3 py-1.5">{t("settings:serviceTier.standard")}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.inputPrice)}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.outputPrice)}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.cacheReadsPrice)}</td>
								</tr>
								{allowedTierNames.includes("flex") && (
									<tr className="border-t border-vscode-dropdown-border/60">
										<td className="px-3 py-1.5">{t("settings:serviceTier.flex")}</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.inputPrice ??
													modelInfo?.inputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.outputPrice ??
													modelInfo?.outputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.cacheReadsPrice ??
													modelInfo?.cacheReadsPrice,
											)}
										</td>
									</tr>
								)}
								{allowedTierNames.includes("priority") && (
									<tr className="border-t border-vscode-dropdown-border/60">
										<td className="px-3 py-1.5">{t("settings:serviceTier.priority")}</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.inputPrice ??
													modelInfo?.inputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.outputPrice ??
													modelInfo?.outputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.cacheReadsPrice ??
													modelInfo?.cacheReadsPrice,
											)}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</>
	)
}

const ModelInfoSupportsItem = ({
	isSupported,
	supportsLabel,
	doesNotSupportLabel,
}: {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}) => (
	<div className="flex items-center gap-1 font-medium">
		<span className={cn("codicon", isSupported ? "codicon-check" : "codicon-x")} />
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</div>
)
