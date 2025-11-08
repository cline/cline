import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

interface TokenDetail {
	title: string
	value?: number
	icon: string
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: number
	contextWindow: number
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

// New accordion item component
const AccordionItem = memo<{
	title: string
	value: React.ReactNode
	isExpanded: boolean
	onToggle: (event?: React.MouseEvent) => void
	children?: React.ReactNode
}>(({ title, value, isExpanded, onToggle, children }) => {
	const handleClick = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
			onToggle(event)
		},
		[onToggle],
	)

	return (
		<div className="flex flex-col w-full">
			<div
				className="flex justify-between items-center gap-1 cursor-pointer hover:bg-foreground/5 rounded p-0.5 transition-colors w-full"
				onClick={handleClick}>
				<div className="flex items-center gap-1">
					{isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
					<div className="font-semibold">{title}</div>
				</div>
				<div className="text-muted-foreground">{value}</div>
			</div>
			{isExpanded && children && <div className="ml-5 my-1 text-xs text-muted-foreground">{children}</div>}
		</div>
	)
})
AccordionItem.displayName = "AccordionItem"

// Constants
const TOKEN_DETAILS_CONFIG: Omit<TokenDetail, "value">[] = [
	{ title: "task_header.prompt_tokens", icon: "codicon-arrow-up" },
	{ title: "task_header.completion_tokens", icon: "codicon-arrow-down" },
	{ title: "task_header.cache_writes", icon: "codicon-arrow-left" },
	{ title: "task_header.cache_reads", icon: "codicon-arrow-right" },
]

const TokenUsageDetails = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const { t } = useTranslation()
	const contextTokenDetails = useMemo(() => {
		const values = [tokensIn, tokensOut, cacheWrites || 0, cacheReads || 0]
		return TOKEN_DETAILS_CONFIG.map((config, index) => ({ ...config, value: values[index] }))
			.filter((item) => item.value)
			.map((item) => ({
				...item,
				title: t(item.title),
			}))
	}, [tokensIn, tokensOut, cacheWrites, cacheReads, t])

	if (!tokensIn) {
		return <div>{t("task_header.no_token_data")}</div>
	}

	return (
		<div className="space-y-1">
			{contextTokenDetails.map((item) => (
				<div className="flex justify-between">
					<span>{item.title}</span>
					<span className="font-mono">{formatTokenNumber(item.value || 0)}</span>
				</div>
			))}
		</div>
	)
})
TokenUsageDetails.displayName = "TokenUsageDetails"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	percentage,
	autoCompactThreshold = 0,
}) => {
	const { t } = useTranslation()
	// Accordion state
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

	const toggleSection = useCallback((section: string, event?: React.MouseEvent) => {
		if (event) {
			event.preventDefault()
			event.stopPropagation()
		}
		setExpandedSections((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(section)) {
				newSet.delete(section)
			} else {
				newSet.add(section)
			}
			return newSet
		})
	}, [])

	const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

	return (
		<div className="context-window-tooltip-content flex flex-col gap-2 bg-menu rounded shadow-sm z-100 w-60 p-1">
			{autoCompactThreshold > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("threshold")}
					onToggle={(event) => toggleSection("threshold", event)}
					title={t("task_header.auto_condense_threshold")}
					value={<span className="text-muted-foreground">{`${(autoCompactThreshold * 100).toFixed(0)}%`}</span>}>
					<div className="space-y-1">
						<p className="text-xs leading-relaxed text-white">{t("task_header.click_context_window_bar")}</p>
						<p className="text-xs leading-relaxed mt-0 mb-0">{t("task_header.context_window_exceeds")}</p>
					</div>
				</AccordionItem>
			)}

			<AccordionItem
				isExpanded={expandedSections.has("context")}
				onToggle={(event) => toggleSection("context", event)}
				title={t("task_header.context_window")}
				value={percentage ? `${percentage.toFixed(1)}%` : formatTokenNumber(contextWindow)}>
				<div className="space-y-1">
					<div className="flex justify-between">
						<span>{t("task_header.used")}:</span>
						<span className="font-mono">{formatTokenNumber(tokenUsed)}</span>
					</div>
					<div className="flex justify-between">
						<span>{t("task_header.total")}:</span>
						<span className="font-mono">{formatTokenNumber(contextWindow)}</span>
					</div>
					<div className="flex justify-between">
						<span>{t("task_header.remaining")}:</span>
						<span className="font-mono">{formatTokenNumber(contextWindow - tokenUsed)}</span>
					</div>
				</div>
			</AccordionItem>

			{totalTokens > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("tokens")}
					onToggle={(event) => toggleSection("tokens", event)}
					title={t("task_header.token_usage")}
					value={`${formatTokenNumber(totalTokens)}`}>
					<TokenUsageDetails
						cacheReads={cacheReads}
						cacheWrites={cacheWrites}
						tokensIn={tokensIn}
						tokensOut={tokensOut}
					/>
				</AccordionItem>
			)}
		</div>
	)
}
