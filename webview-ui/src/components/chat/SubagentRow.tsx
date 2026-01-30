import { SubagentStatusEntry } from "@shared/cline/subagent"
import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import {
	AlertTriangleIcon,
	CheckCircle2Icon,
	FileTextIcon,
	GlobeIcon,
	Loader2Icon,
	PlayIcon,
	ScanSearchIcon,
	SearchIcon,
} from "lucide-react"
import React, { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"

interface SubagentRowProps {
	message: ClineMessage
	tool: ClineSayTool
	className?: string
}

const getStatusIcon = (type: SubagentStatusEntry["type"], isLast: boolean) => {
	const iconClass = isLast ? "size-3 animate-pulse" : "size-3"
	switch (type) {
		case "searching":
			return <SearchIcon className={iconClass} />
		case "reading":
			return <FileTextIcon className={iconClass} />
		case "running":
			return <PlayIcon className={iconClass} />
		case "fetching":
			return <GlobeIcon className={iconClass} />
		case "ready":
			return <CheckCircle2Icon className={iconClass} />
		case "error":
			return <AlertTriangleIcon className={`${iconClass} text-warning`} />
		default:
			return <ScanSearchIcon className={iconClass} />
	}
}

const SubagentRow: React.FC<SubagentRowProps> = ({ className, message, tool }) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const statusEntries = useMemo((): SubagentStatusEntry[] => {
		if (!tool.content) {
			return []
		}
		try {
			const parsed = JSON.parse(tool.content)
			if (Array.isArray(parsed)) {
				return parsed as SubagentStatusEntry[]
			}
		} catch {
			// Fallback for old format (plain string)
		}
		return []
	}, [tool.content])

	const latestStatus = statusEntries.length > 0 ? statusEntries[statusEntries.length - 1] : null
	const isRunning = message.partial !== false

	return (
		<div key={message.uid}>
			<div className={className}>
				{isRunning ? <Loader2Icon className="size-2 animate-spin" /> : <ScanSearchIcon className="size-2" />}
				<span className="bold">Subagent:</span>
				<span className="text-description truncate">{tool.filePattern}</span>
			</div>
			<Button
				className="bg-code-block-background text-description border border-editor-group-border rounded-xs overflow-hidden w-full flex flex-col justify-start items-start text-left p-2"
				key={message.ts}
				onClick={() => setIsExpanded(!isExpanded)}
				variant="ghost">
				{/* Current status summary */}
				{latestStatus && (
					<div className="w-full flex items-center gap-2 text-xs">
						<span className="text-muted-foreground">
							[{latestStatus.iteration}/{latestStatus.maxIterations}]
						</span>
						<span className="truncate">{latestStatus.status}</span>
					</div>
				)}

				{/* Timeline when expanded */}
				{isExpanded && statusEntries.length > 0 && (
					<div className="w-full flex flex-col gap-0.5 text-left select-text pt-2 max-h-60 overflow-y-auto">
						{statusEntries.map((entry, index) => {
							const isLast = index === statusEntries.length - 1
							const isError = entry.type === "error"
							return (
								<div
									className={`flex items-start gap-2 text-xs py-0.5 ${isError ? "text-warning" : isLast && isRunning ? "text-foreground" : "text-muted-foreground"}`}
									key={`${entry.timestamp}-${index}`}>
									<div className="flex items-center gap-1.5 min-w-[60px]">
										{getStatusIcon(entry.type, isLast && isRunning)}
										<span className={isError ? "text-warning" : "text-muted-foreground"}>
											[{entry.iteration}/{entry.maxIterations}]
										</span>
									</div>
									<span className="break-words">{entry.status}</span>
								</div>
							)
						})}
					</div>
				)}

				{/* Fallback for old format or empty */}
				{statusEntries.length === 0 && tool.content && (
					<div className="w-full text-xs text-muted-foreground">{tool.content}</div>
				)}
			</Button>
		</div>
	)
}

export default SubagentRow
