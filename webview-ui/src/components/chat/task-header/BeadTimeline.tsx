/**
 * BeadTimeline - Shows progress through beads in the Ralph Wiggum loop.
 *
 * Displays the current bead number, status, and provides visual indication
 * of iteration progress within the task header.
 */

import { BeadTaskStatus } from "@shared/beads"
import {
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	CirclePauseIcon,
	CirclePlayIcon,
	LoaderCircleIcon,
	XCircleIcon,
} from "lucide-react"
import { memo, useCallback, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

interface BeadTimelineProps {
	className?: string
}

const getStatusIcon = (status: BeadTaskStatus) => {
	switch (status) {
		case "running":
			return <LoaderCircleIcon className="size-4 animate-spin text-link" />
		case "awaiting_approval":
			return <CircleAlertIcon className="size-4 text-warning" />
		case "paused":
			return <CirclePauseIcon className="size-4 text-foreground/70" />
		case "completed":
			return <CheckCircleIcon className="size-4 text-success" />
		case "failed":
			return <XCircleIcon className="size-4 text-error" />
		case "idle":
		default:
			return <CirclePlayIcon className="size-4 text-foreground/50" />
	}
}

const getStatusText = (status: BeadTaskStatus) => {
	switch (status) {
		case "running":
			return "Running"
		case "awaiting_approval":
			return "Awaiting Approval"
		case "paused":
			return "Paused"
		case "completed":
			return "Completed"
		case "failed":
			return "Failed"
		case "idle":
		default:
			return "Idle"
	}
}

const getStatusColor = (status: BeadTaskStatus) => {
	switch (status) {
		case "running":
			return "text-link"
		case "awaiting_approval":
			return "text-warning"
		case "completed":
			return "text-success"
		case "failed":
			return "text-error"
		default:
			return "text-foreground/70"
	}
}

export const BeadTimeline = memo<BeadTimelineProps>(({ className }) => {
	const { beadsEnabled, currentBeadNumber, beadTaskStatus, totalBeadsCompleted } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)

	const toggleExpanded = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	// Don't render if beads are not enabled or no task is active
	if (!beadsEnabled || (beadTaskStatus === "idle" && totalBeadsCompleted === 0)) {
		return null
	}

	const status = (beadTaskStatus as BeadTaskStatus) || "idle"
	const isActive = status === "running" || status === "awaiting_approval"

	return (
		<div
			className={cn(
				"rounded-sm border overflow-hidden",
				{
					"border-link/30 bg-link/5": status === "running",
					"border-warning/30 bg-warning/5": status === "awaiting_approval",
					"border-success/30 bg-success/5": status === "completed",
					"border-error/30 bg-error/5": status === "failed",
					"border-foreground/20 bg-foreground/5": status === "idle" || status === "paused",
				},
				className,
			)}>
			{/* Header */}
			<button
				className="w-full flex items-center justify-between gap-2 py-2 px-2.5 cursor-pointer hover:bg-foreground/5 transition-colors"
				onClick={toggleExpanded}
				type="button">
				<div className="flex items-center gap-2 min-w-0">
					{getStatusIcon(status)}
					<span className="font-medium text-sm">Ralph Loop</span>
					<span
						className={cn(
							"rounded-lg px-2 py-0.25 text-xs font-medium",
							"bg-badge-foreground/20 text-foreground",
							{
								"bg-success text-black": status === "completed",
							},
						)}>
						Bead {currentBeadNumber || 0}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className={cn("text-xs", getStatusColor(status))}>{getStatusText(status)}</span>
					{isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
				</div>
			</button>

			{/* Expanded Details */}
			{isExpanded && (
				<div className="px-3 pb-2.5 pt-1 border-t border-foreground/10">
					<div className="grid grid-cols-2 gap-2 text-xs">
						<div className="opacity-70">Current Bead:</div>
						<div className="font-medium">{currentBeadNumber || 0}</div>

						<div className="opacity-70">Total Completed:</div>
						<div className="font-medium">{totalBeadsCompleted || 0}</div>

						<div className="opacity-70">Status:</div>
						<div className={cn("font-medium", getStatusColor(status))}>{getStatusText(status)}</div>
					</div>

					{/* Progress bar for running state */}
					{isActive && (
						<div className="mt-2 pt-2 border-t border-foreground/10">
							<div className="flex items-center gap-2">
								<div className="flex-1 h-1 bg-foreground/10 rounded-full overflow-hidden">
									<div
										className={cn("h-full transition-all duration-300", {
											"bg-link animate-pulse": status === "running",
											"bg-warning": status === "awaiting_approval",
										})}
										style={{
											width: status === "awaiting_approval" ? "100%" : "50%",
										}}
									/>
								</div>
								<span className="text-[10px] opacity-60">
									{status === "awaiting_approval" ? "Review required" : "In progress..."}
								</span>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	)
})

BeadTimeline.displayName = "BeadTimeline"

export default BeadTimeline
