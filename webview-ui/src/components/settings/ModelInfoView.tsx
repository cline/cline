import { useMemo } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { formatPrice } from "@/utils/formatPrice"
import { cn } from "@/lib/utils"

import { ModelInfo, geminiModels } from "../../../../src/shared/api"

import { ModelDescriptionMarkdown } from "./ModelDescriptionMarkdown"

type ModelInfoViewProps = {
	selectedModelId: string
	modelInfo: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (isExpanded: boolean) => void
}

export const ModelInfoView = ({
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
}: ModelInfoViewProps) => {
	const isGemini = useMemo(() => Object.keys(geminiModels).includes(selectedModelId), [selectedModelId])

	const infoItems = [
		<ModelInfoSupportsItem
			isSupported={modelInfo.supportsImages ?? false}
			supportsLabel="Supports images"
			doesNotSupportLabel="Does not support images"
		/>,
		<ModelInfoSupportsItem
			isSupported={modelInfo.supportsComputerUse ?? false}
			supportsLabel="Supports computer use"
			doesNotSupportLabel="Does not support computer use"
		/>,
		!isGemini && (
			<ModelInfoSupportsItem
				isSupported={modelInfo.supportsPromptCache}
				supportsLabel="Supports prompt caching"
				doesNotSupportLabel="Does not support prompt caching"
			/>
		),
		modelInfo.maxTokens !== undefined && modelInfo.maxTokens > 0 && (
			<>
				<span className="font-medium">Max output:</span> {modelInfo.maxTokens?.toLocaleString()} tokens
			</>
		),
		modelInfo.inputPrice !== undefined && modelInfo.inputPrice > 0 && (
			<>
				<span className="font-medium">Input price:</span> {formatPrice(modelInfo.inputPrice)} / 1M tokens
			</>
		),
		modelInfo.outputPrice !== undefined && modelInfo.outputPrice > 0 && (
			<>
				<span className="font-medium">Output price:</span> {formatPrice(modelInfo.outputPrice)} / 1M tokens
			</>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<>
				<span className="font-medium">Cache reads price:</span> {formatPrice(modelInfo.cacheReadsPrice || 0)} /
				1M tokens
			</>
		),
		modelInfo.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<>
				<span className="font-medium">Cache writes price:</span> {formatPrice(modelInfo.cacheWritesPrice || 0)}{" "}
				/ 1M tokens
			</>
		),
		isGemini && (
			<span className="italic">
				* Free up to {selectedModelId && selectedModelId.includes("flash") ? "15" : "2"} requests per minute.
				After that, billing depends on prompt size.{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" className="text-sm">
					For more info, see pricing details.
				</VSCodeLink>
			</span>
		),
	].filter(Boolean)

	return (
		<>
			{modelInfo.description && (
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
	<div
		className={cn(
			"flex items-center gap-1 font-medium",
			isSupported ? "text-vscode-charts-green" : "text-vscode-errorForeground",
		)}>
		<span className={cn("codicon", isSupported ? "codicon-check" : "codicon-x")} />
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</div>
)
