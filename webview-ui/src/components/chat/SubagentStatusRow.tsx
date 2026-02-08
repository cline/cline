import { ClineMessage, ClineSaySubagentStatus, SubagentExecutionStatus } from "@shared/ExtensionMessage"
import { CheckIcon, CircleSlashIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react"
import { useMemo } from "react"

interface SubagentStatusRowProps {
	message: ClineMessage
	isLast: boolean
	lastModifiedMessage?: ClineMessage
}

const statusLabel = (status: SubagentExecutionStatus): string => {
	switch (status) {
		case "pending":
			return "Pending"
		case "running":
			return "Running"
		case "completed":
			return "Completed"
		case "failed":
			return "Failed"
		default:
			return "Unknown"
	}
}

const aggregateIcon = (status: ClineSaySubagentStatus["status"]) => {
	switch (status) {
		case "running":
			return <LoaderCircleIcon className="size-2 mr-2 animate-spin text-link" />
		case "completed":
			return <CheckIcon className="size-2 mr-2 text-success" />
		case "failed":
			return <CircleXIcon className="size-2 mr-2 text-error" />
		default:
			return <LoaderCircleIcon className="size-2 mr-2 animate-spin text-link" />
	}
}

const formatCount = (value: number | undefined): string => {
	if (!Number.isFinite(value)) {
		return "0"
	}

	return Intl.NumberFormat("en-US").format(value || 0)
}

export default function SubagentStatusRow({ message, isLast, lastModifiedMessage }: SubagentStatusRowProps) {
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

	const wasCancelled =
		data.status === "running" &&
		(!isLast || lastModifiedMessage?.ask === "resume_task" || lastModifiedMessage?.ask === "resume_completed_task")
	const displayStatus: ClineSaySubagentStatus["status"] = wasCancelled ? "failed" : data.status

	return (
		<div className="bg-code border border-editor-group-border rounded-sm py-2.5 px-3">
			<div className="flex items-center">
				{wasCancelled ? <CircleSlashIcon className="size-2 mr-2" /> : aggregateIcon(displayStatus)}
				<span className="font-semibold text-foreground">Subagent batch</span>
				{wasCancelled && <span className="ml-2 text-xs opacity-80">Cancelled</span>}
				<div className="ml-2 text-xs opacity-80">
					{data.completed}/{data.total} complete, {data.successes} succeeded, {data.failures} failed
				</div>
			</div>
			<div className="mt-2 text-xs opacity-75">
				{formatCount(data.toolCalls)} tool calls, {formatCount(data.inputTokens)} input tokens,{" "}
				{formatCount(data.outputTokens)} output tokens
			</div>
			<div className="mt-2 space-y-2">
				{data.items.map((entry) => (
					<div
						className="rounded-xs border border-editor-group-border bg-vscode-editor-background px-2 py-1.5"
						key={entry.index}>
						<div className="flex items-center justify-between gap-2">
							<div className="text-xs font-medium text-foreground">
								[{entry.index}] {statusLabel(entry.status)}
							</div>
							<div className="text-[11px] opacity-70">
								{formatCount(entry.toolCalls || 0)} tools, {formatCount(entry.inputTokens || 0)} in,{" "}
								{formatCount(entry.outputTokens || 0)} out
							</div>
						</div>
						<div className="mt-1 text-xs font-editor whitespace-pre-wrap break-words">{entry.prompt}</div>
						{entry.result && entry.status === "completed" && (
							<div className="mt-1 text-xs opacity-80 whitespace-pre-wrap break-words">{entry.result}</div>
						)}
						{entry.error && entry.status === "failed" && (
							<div className="mt-1 text-xs text-error whitespace-pre-wrap break-words">{entry.error}</div>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
