import {
	ClineAskUseSubagents,
	ClineMessage,
	ClineSaySubagentStatus,
	SubagentExecutionStatus,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	NetworkIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface SubagentStatusRowProps {
	message: ClineMessage
	isLast: boolean
	lastModifiedMessage?: ClineMessage
}

type DisplayStatus = SubagentExecutionStatus | "cancelled"
type SubagentRowStatus = "pending" | "running" | "completed" | "failed"

interface SubagentRowData {
	status: SubagentRowStatus
	items: SubagentStatusItem[]
}

interface SubagentPromptTextProps {
	prompt: string
	isExpanded: boolean
	onShowMore: () => void
}

const statusIcon = (status: DisplayStatus) => {
	switch (status) {
		case "running":
			return <LoaderCircleIcon className="size-2 animate-spin text-link shrink-0 mt-[1px]" />
		case "completed":
			return <CheckIcon className="size-2 text-success shrink-0 mt-[1px]" />
		case "failed":
			return <CircleXIcon className="size-2 text-error shrink-0 mt-[1px]" />
		case "cancelled":
			return <CircleSlashIcon className="size-2 text-foreground shrink-0 mt-[1px]" />
		default:
			return <BotIcon className="size-2 text-foreground/70 shrink-0 mt-[1px]" />
	}
}

const formatCount = (value: number | undefined): string => {
	if (!Number.isFinite(value)) {
		return "0"
	}

	return Intl.NumberFormat("en-US").format(value || 0)
}

const formatCost = (value: number | undefined): string => {
	const normalized = Number.isFinite(value) ? Math.max(0, value || 0) : 0
	const maximumFractionDigits = normalized >= 0.01 ? 2 : 4
	return Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(normalized)
}

function parseSubagentRowData(message: ClineMessage): SubagentRowData | null {
	if (!message.text) {
		return null
	}

	try {
		if (message.ask === "use_subagents" || message.say === "use_subagents") {
			const parsed = JSON.parse(message.text) as ClineAskUseSubagents
			if (!Array.isArray(parsed.prompts)) {
				return null
			}
			const prompts = parsed.prompts.map((prompt) => prompt?.trim()).filter((prompt): prompt is string => !!prompt)
			if (prompts.length === 0) {
				return null
			}

			return {
				status: "pending",
				items: prompts.map((prompt, index) => ({
					index: index + 1,
					prompt,
					status: "pending",
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalCost: 0,
					contextTokens: 0,
					contextWindow: 0,
					contextUsagePercentage: 0,
				})),
			}
		}

		const parsed = JSON.parse(message.text) as ClineSaySubagentStatus
		if (!Array.isArray(parsed.items)) {
			return null
		}

		return {
			status: parsed.status,
			items: parsed.items,
		}
	} catch {
		return null
	}
}

function SubagentPromptText({ prompt, isExpanded, onShowMore }: SubagentPromptTextProps) {
	const promptRef = useRef<HTMLDivElement | null>(null)
	const [showMoreVisible, setShowMoreVisible] = useState(false)

	useEffect(() => {
		if (isExpanded) {
			setShowMoreVisible(false)
			return
		}

		const element = promptRef.current
		if (!element) {
			setShowMoreVisible(false)
			return
		}

		const checkOverflow = () => {
			setShowMoreVisible(element.scrollHeight - element.clientHeight > 1)
		}

		checkOverflow()

		if (typeof ResizeObserver === "undefined") {
			return
		}

		const observer = new ResizeObserver(() => checkOverflow())
		observer.observe(element)

		return () => observer.disconnect()
	}, [prompt, isExpanded])

	return (
		<div className="relative">
			<div
				className={`text-xs font-medium text-foreground whitespace-pre-wrap break-words ${!isExpanded ? "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" : ""}`}
				ref={promptRef}>
				"{prompt}"
			</div>
			{!isExpanded && showMoreVisible && (
				<button
					aria-label="Show full subagent prompt"
					className="absolute right-0 bottom-0 z-10 text-[11px] text-link border-0 px-1 py-[1px] cursor-pointer leading-none rounded-[2px]"
					onClick={onShowMore}
					style={{ backgroundColor: "var(--vscode-editor-background)" }}
					type="button">
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 -left-[6px] w-[6px]"
						style={{ background: "linear-gradient(to left, var(--vscode-editor-background), transparent)" }}
					/>
					Show more
				</button>
			)}
		</div>
	)
}

export default function SubagentStatusRow({ message, isLast, lastModifiedMessage }: SubagentStatusRowProps) {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})
	const [expandedPrompts, setExpandedPrompts] = useState<Record<number, boolean>>({})
	const data = useMemo(() => parseSubagentRowData(message), [message])

	if (!data) {
		return <div className="text-foreground opacity-80">Subagent status update unavailable.</div>
	}

	const resumedBeforeNextVisibleMessage =
		isLast && lastModifiedMessage?.say === "api_req_started" && (lastModifiedMessage.ts ?? 0) > message.ts

	const wasCancelled =
		data.status === "running" &&
		(!isLast ||
			lastModifiedMessage?.ask === "resume_task" ||
			lastModifiedMessage?.ask === "resume_completed_task" ||
			resumedBeforeNextVisibleMessage)

	const singular = data.items.length === 1
	const title = singular ? "Cline wants to use a subagent:" : "Cline wants to use subagents:"
	const isPromptConstructionRow = message.ask === "use_subagents" || message.say === "use_subagents"
	const toggleItem = (index: number) => {
		setExpandedItems((prev) => ({
			...prev,
			[index]: !prev[index],
		}))
	}
	const expandPrompt = (index: number) => {
		setExpandedPrompts((prev) => ({
			...prev,
			[index]: true,
		}))
	}

	return (
		<div className="mb-2">
			<div className="flex items-center gap-2.5 mb-3">
				<NetworkIcon className="size-2 text-foreground" />
				<span className="font-bold text-foreground">{title}</span>
			</div>
			<div className="space-y-2">
				{data.items.map((entry, index) => {
					const displayStatus: DisplayStatus =
						wasCancelled && (entry.status === "running" || entry.status === "pending") ? "cancelled" : entry.status
					const hasDetails = Boolean(
						(entry.result && entry.status === "completed") || (entry.error && entry.status === "failed"),
					)
					const isExpanded = expandedItems[entry.index] === true
					const isStreamingPromptUnderConstruction =
						isPromptConstructionRow && message.partial === true && index === data.items.length - 1
					const shouldShowStats = !isStreamingPromptUnderConstruction
					const statsText = `${formatCount(entry.toolCalls)} tools called · ${formatCount(entry.contextTokens)} tokens · ${formatCost(entry.totalCost)}`
					const latestToolCallText = entry.latestToolCall?.trim() || ""
					return (
						<div
							className="rounded-xs border border-editor-group-border px-2 py-1.5"
							key={entry.index}
							style={{ backgroundColor: "var(--vscode-editor-background)" }}>
							<div className="flex items-start gap-2">
								{statusIcon(displayStatus)}
								<div className="min-w-0 flex-1">
									<SubagentPromptText
										isExpanded={expandedPrompts[entry.index] === true}
										onShowMore={() => expandPrompt(entry.index)}
										prompt={entry.prompt}
									/>
								</div>
							</div>
							{shouldShowStats && (
								<div className="mt-1 text-[11px] opacity-70 min-w-0 whitespace-pre-wrap break-words">
									<span>{statsText}</span>
								</div>
							)}
							{shouldShowStats && hasDetails && (
								<button
									aria-label={isExpanded ? "Hide subagent output" : "Show subagent output"}
									className="mt-1 text-[11px] opacity-80 flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-left text-foreground w-full"
									onClick={() => toggleItem(entry.index)}
									type="button">
									{isExpanded ? (
										<ChevronDownIcon className="size-2 shrink-0" />
									) : (
										<ChevronRightIcon className="size-2 shrink-0" />
									)}
									<span className="shrink-0">{isExpanded ? "Hide output" : "Show output"}</span>
								</button>
							)}
							{shouldShowStats && !hasDetails && latestToolCallText && (
								<div className="mt-1 text-[10px] opacity-70 min-w-0 truncate font-mono">{latestToolCallText}</div>
							)}
							{isExpanded && entry.result && entry.status === "completed" && (
								<div className="mt-2 text-xs opacity-80 wrap-anywhere overflow-hidden">
									<MarkdownBlock markdown={entry.result} />
								</div>
							)}
							{isExpanded && entry.error && entry.status === "failed" && (
								<div className="mt-2 text-xs text-error whitespace-pre-wrap break-words">{entry.error}</div>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
