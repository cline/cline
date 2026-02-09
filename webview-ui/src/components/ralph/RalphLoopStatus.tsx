/**
 * RalphLoopStatus - Real-time status tracker for Ralph Wiggum loop execution.
 *
 * Displays:
 * - Current iteration number and progress
 * - Loop status (running/paused/completed/failed)
 * - Files changed, tokens used
 * - Control buttons (pause/resume/cancel)
 * - Timeline of completed iterations
 */

import {
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	CircleIcon,
	CirclePauseIcon,
	CircleStopIcon,
	ClockIcon,
	FileTextIcon,
	LoaderCircleIcon,
	PauseIcon,
	PlayIcon,
	XCircleIcon,
} from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

export type LoopStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled"

export interface IterationSummary {
	number: number
	status: "completed" | "failed" | "current"
	filesChanged: number
	tokensUsed: number
	duration: number
	errors?: string[]
}

export interface RalphLoopStatusState {
	status: LoopStatus
	currentIteration: number
	maxIterations: number
	totalTokensUsed: number
	totalFilesChanged: number
	startTime: number | null
	iterations: IterationSummary[]
	beadsEnabled: boolean
	pendingBeadApproval: boolean
}

interface RalphLoopStatusProps {
	state: RalphLoopStatusState
	onPause: () => void
	onResume: () => void
	onCancel: () => void
	onViewDetails?: () => void
}

const formatDuration = (ms: number): string => {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`
	}
	return `${seconds}s`
}

const RalphLoopStatus = memo(({ state, onPause, onResume, onCancel, onViewDetails }: RalphLoopStatusProps) => {
	const [isExpanded, setIsExpanded] = useState(true)

	const elapsedTime = useMemo(() => {
		if (!state.startTime) return 0
		return Date.now() - state.startTime
	}, [state.startTime])

	const progress = useMemo(() => {
		return Math.min((state.currentIteration / state.maxIterations) * 100, 100)
	}, [state.currentIteration, state.maxIterations])

	const statusConfig = useMemo(() => {
		switch (state.status) {
			case "running":
				return {
					icon: <LoaderCircleIcon className="size-4 animate-spin text-link" />,
					label: "Running",
					color: "text-link",
					bgColor: "bg-link/10",
					borderColor: "border-link/30",
				}
			case "paused":
				return {
					icon: <CirclePauseIcon className="size-4 text-warning" />,
					label: "Paused",
					color: "text-warning",
					bgColor: "bg-warning/10",
					borderColor: "border-warning/30",
				}
			case "completed":
				return {
					icon: <CheckCircleIcon className="size-4 text-success" />,
					label: "Completed",
					color: "text-success",
					bgColor: "bg-success/10",
					borderColor: "border-success/30",
				}
			case "failed":
				return {
					icon: <XCircleIcon className="size-4 text-error" />,
					label: "Failed",
					color: "text-error",
					bgColor: "bg-error/10",
					borderColor: "border-error/30",
				}
			case "cancelled":
				return {
					icon: <CircleStopIcon className="size-4 text-muted-foreground" />,
					label: "Cancelled",
					color: "text-muted-foreground",
					bgColor: "bg-muted/10",
					borderColor: "border-muted/30",
				}
			default:
				return {
					icon: <CircleIcon className="size-4 text-muted-foreground" />,
					label: "Idle",
					color: "text-muted-foreground",
					bgColor: "bg-muted/10",
					borderColor: "border-muted/30",
				}
		}
	}, [state.status])

	const handleToggleExpand = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	if (state.status === "idle") {
		return null
	}

	return (
		<div className={cn("rounded-sm border", statusConfig.bgColor, statusConfig.borderColor)}>
			{/* Header - Always visible */}
			<div
				className="flex items-center justify-between px-3 py-2 cursor-pointer"
				onClick={handleToggleExpand}>
				<div className="flex items-center gap-2">
					{statusConfig.icon}
					<span className={cn("font-semibold text-sm", statusConfig.color)}>
						Ralph Loop - {statusConfig.label}
					</span>
					{state.status === "running" && state.beadsEnabled && state.pendingBeadApproval && (
						<span className="px-1.5 py-0.5 bg-warning/20 text-warning text-xs rounded-full">
							Awaiting Approval
						</span>
					)}
				</div>

				<div className="flex items-center gap-3">
					<div className="text-xs text-muted-foreground">
						Iteration {state.currentIteration} / {state.maxIterations}
					</div>
					{isExpanded ? (
						<ChevronUpIcon className="size-4 text-muted-foreground" />
					) : (
						<ChevronDownIcon className="size-4 text-muted-foreground" />
					)}
				</div>
			</div>

			{/* Progress Bar */}
			<div className="px-3 pb-2">
				<div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
					<div
						className={cn("h-full transition-all duration-300", {
							"bg-link": state.status === "running",
							"bg-warning": state.status === "paused",
							"bg-success": state.status === "completed",
							"bg-error": state.status === "failed",
							"bg-muted-foreground": state.status === "cancelled",
						})}
						style={{ width: `${progress}%` }}
					/>
				</div>
			</div>

			{/* Expanded Content */}
			{isExpanded && (
				<div className="px-3 pb-3 space-y-3">
					{/* Stats */}
					<div className="grid grid-cols-3 gap-3 text-center">
						<div className="bg-black/10 rounded-sm py-2">
							<div className="text-lg font-semibold">{state.currentIteration}</div>
							<div className="text-xs text-muted-foreground">Iterations</div>
						</div>
						<div className="bg-black/10 rounded-sm py-2">
							<div className="text-lg font-semibold">{state.totalFilesChanged}</div>
							<div className="text-xs text-muted-foreground">Files Changed</div>
						</div>
						<div className="bg-black/10 rounded-sm py-2">
							<div className="text-lg font-semibold">
								{state.totalTokensUsed > 1000
									? `${(state.totalTokensUsed / 1000).toFixed(1)}k`
									: state.totalTokensUsed}
							</div>
							<div className="text-xs text-muted-foreground">Tokens Used</div>
						</div>
					</div>

					{/* Time Elapsed */}
					{state.startTime && (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<ClockIcon className="size-3" />
							<span>Elapsed: {formatDuration(elapsedTime)}</span>
						</div>
					)}

					{/* Iteration Timeline */}
					{state.iterations.length > 0 && (
						<div>
							<div className="text-xs font-medium mb-2">Recent Iterations</div>
							<div className="space-y-1 max-h-32 overflow-y-auto">
								{state.iterations.slice(-5).map((iteration) => (
									<div
										key={iteration.number}
										className={cn(
											"flex items-center justify-between px-2 py-1.5 rounded-sm text-xs",
											{
												"bg-success/10": iteration.status === "completed",
												"bg-error/10": iteration.status === "failed",
												"bg-link/10": iteration.status === "current",
											},
										)}>
										<div className="flex items-center gap-1.5">
											{iteration.status === "completed" && (
												<CheckCircleIcon className="size-3 text-success" />
											)}
											{iteration.status === "failed" && <XCircleIcon className="size-3 text-error" />}
											{iteration.status === "current" && (
												<LoaderCircleIcon className="size-3 text-link animate-spin" />
											)}
											<span>Iteration {iteration.number}</span>
										</div>
										<div className="flex items-center gap-3 text-muted-foreground">
											{iteration.filesChanged > 0 && (
												<span className="flex items-center gap-0.5">
													<FileTextIcon className="size-2.5" />
													{iteration.filesChanged}
												</span>
											)}
											<span>{formatDuration(iteration.duration)}</span>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Controls */}
					<div className="flex items-center gap-2 pt-2 border-t border-black/10">
						{state.status === "running" && (
							<>
								<button
									onClick={(e) => {
										e.stopPropagation()
										onPause()
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/20 text-warning border border-warning/30 rounded-sm text-xs hover:bg-warning/30 transition-colors">
									<PauseIcon className="size-3" />
									Pause
								</button>
								<button
									onClick={(e) => {
										e.stopPropagation()
										onCancel()
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-error/20 text-error border border-error/30 rounded-sm text-xs hover:bg-error/30 transition-colors">
									<CircleStopIcon className="size-3" />
									Cancel
								</button>
							</>
						)}

						{state.status === "paused" && (
							<>
								<button
									onClick={(e) => {
										e.stopPropagation()
										onResume()
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-success/20 text-success border border-success/30 rounded-sm text-xs hover:bg-success/30 transition-colors">
									<PlayIcon className="size-3" />
									Resume
								</button>
								<button
									onClick={(e) => {
										e.stopPropagation()
										onCancel()
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-error/20 text-error border border-error/30 rounded-sm text-xs hover:bg-error/30 transition-colors">
									<CircleStopIcon className="size-3" />
									Cancel
								</button>
							</>
						)}

						{(state.status === "completed" ||
							state.status === "failed" ||
							state.status === "cancelled") &&
							onViewDetails && (
								<button
									onClick={(e) => {
										e.stopPropagation()
										onViewDetails()
									}}
									className="flex items-center gap-1.5 px-3 py-1.5 bg-link/20 text-link border border-link/30 rounded-sm text-xs hover:bg-link/30 transition-colors">
									View Details
								</button>
							)}
					</div>
				</div>
			)}
		</div>
	)
})

RalphLoopStatus.displayName = "RalphLoopStatus"

export default RalphLoopStatus
