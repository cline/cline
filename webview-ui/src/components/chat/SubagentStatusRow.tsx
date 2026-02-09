import { ClineMessage, ClineSaySubagentStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
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
import { useMemo, useState } from "react"

interface SubagentStatusRowProps {
	message: ClineMessage
	isLast: boolean
	lastModifiedMessage?: ClineMessage
}

type DisplayStatus = SubagentExecutionStatus | "cancelled"

const statusLabel = (status: DisplayStatus): string => {
	switch (status) {
		case "pending":
			return "Pending"
		case "running":
			return "Running"
		case "completed":
			return "Completed"
		case "failed":
			return "Failed"
		case "cancelled":
			return "Cancelled"
		default:
			return "Unknown"
	}
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

export default function SubagentStatusRow({ message, isLast, lastModifiedMessage }: SubagentStatusRowProps) {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})
	const data = useMemo(() => {
		try {
			if (!message.text) {
				return null
			}
			return JSON.parse(message.text) as ClineSaySubagentStatus
		} catch {
			return null
		}
	}, [message.text])

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
	const toggleItem = (index: number) => {
		setExpandedItems((prev) => ({
			...prev,
			[index]: !prev[index],
		}))
	}

	return (
		<div className="mb-2">
			<div className="flex items-center gap-2.5 mb-3">
				<NetworkIcon className="size-2 text-foreground" />
				<span className="font-bold text-foreground">{title}</span>
			</div>
			<div className="space-y-2">
				{data.items.map((entry) => {
					const displayStatus: DisplayStatus =
						wasCancelled && (entry.status === "running" || entry.status === "pending") ? "cancelled" : entry.status
					const hasDetails = Boolean(
						(entry.result && entry.status === "completed") || (entry.error && entry.status === "failed"),
					)
					const isExpanded = expandedItems[entry.index] === true
					return (
						<div
							className="rounded-xs border border-editor-group-border bg-vscode-editor-background px-2 py-1.5"
							key={entry.index}>
							<div className="flex items-start gap-2">
								{statusIcon(displayStatus)}
								<div className="min-w-0 flex-1">
									<div className="text-xs font-medium text-foreground whitespace-pre-wrap break-words">
										"{entry.prompt}"
									</div>
								</div>
							</div>
							<div className="mt-1 text-[11px] opacity-70">
								{statusLabel(displayStatus)} | {formatCount(entry.toolCalls)} tools called |{" "}
								{formatCount(entry.contextTokens)} tokens used
							</div>
							{hasDetails && (
								<button
									aria-label={isExpanded ? "Collapse subagent output" : "Expand subagent output"}
									className="mt-1 text-[11px] opacity-80 flex items-center gap-1.5 bg-transparent border-0 p-0 cursor-pointer text-left text-foreground"
									onClick={() => toggleItem(entry.index)}
									type="button">
									{isExpanded ? (
										<ChevronDownIcon className="size-2" />
									) : (
										<ChevronRightIcon className="size-2" />
									)}
									<span>{isExpanded ? "Hide output" : "Show output"}</span>
								</button>
							)}
							{isExpanded && entry.result && entry.status === "completed" && (
								<div className="mt-2 text-xs opacity-80 whitespace-pre-wrap break-words">{entry.result}</div>
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
