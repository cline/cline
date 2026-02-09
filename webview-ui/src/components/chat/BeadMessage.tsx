/**
 * BeadMessage - Renders bead-related messages in the chat view.
 *
 * Handles:
 * - bead_started: Shows when a new iteration begins
 * - bead_completed: Shows iteration completion with summary
 * - bead_failed: Shows iteration failure with errors
 * - bead_review: Shows approval request for completed bead
 */

import {
	BeadsmithAskBeadReview,
	BeadsmithMessage,
	BeadsmithSayBeadCompleted,
	BeadsmithSayBeadFailed,
	BeadsmithSayBeadStarted,
} from "@shared/ExtensionMessage"
import { ApproveBeadRequest, RejectBeadRequest } from "@shared/proto/beadsmith/bead"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
import {
	CheckIcon,
	CircleAlertIcon,
	CirclePlayIcon,
	FileTextIcon,
	GitBranchIcon,
	LoaderCircleIcon,
	SkipForwardIcon,
	ThumbsDownIcon,
	ThumbsUpIcon,
	XIcon,
} from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { BeadServiceClient } from "@/services/grpc-client"

interface BeadMessageProps {
	message: BeadsmithMessage
	isLast?: boolean
}

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-2"

/**
 * Renders a bead_started message.
 */
export const BeadStartedMessage = memo(({ message }: BeadMessageProps) => {
	const info = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as BeadsmithSayBeadStarted
		} catch {
			return { beadNumber: 1, taskId: "", taskDescription: "" }
		}
	}, [message.text])

	return (
		<div className="bg-link/10 border border-link/30 rounded-sm py-2.5 px-3">
			<div className={HEADER_CLASSNAMES}>
				<CirclePlayIcon className="size-2 text-link" />
				<span className="font-semibold text-link">Ralph Loop - Iteration {info.beadNumber}</span>
			</div>
			{info.taskDescription && <div className="ml-6 opacity-80 text-sm break-words">{info.taskDescription}</div>}
		</div>
	)
})

BeadStartedMessage.displayName = "BeadStartedMessage"

/**
 * Renders a bead_completed message.
 */
export const BeadCompletedMessage = memo(({ message }: BeadMessageProps) => {
	const info = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as BeadsmithSayBeadCompleted
		} catch {
			return { beadNumber: 1, filesChanged: [], tokensUsed: 0, success: true, errors: [] }
		}
	}, [message.text])

	const hasErrors = info.errors && info.errors.length > 0

	return (
		<div
			className={cn("border rounded-sm py-2.5 px-3", {
				"bg-success/10 border-success/30": info.success && !hasErrors,
				"bg-warning/10 border-warning/30": hasErrors,
			})}>
			<div className={HEADER_CLASSNAMES}>
				{info.success && !hasErrors ? (
					<CheckIcon className="size-2 text-success" />
				) : (
					<CircleAlertIcon className="size-2 text-warning" />
				)}
				<span className={cn("font-semibold", info.success && !hasErrors ? "text-success" : "text-warning")}>
					Iteration {info.beadNumber} {info.success ? "Completed" : "Completed with Issues"}
				</span>
			</div>

			<div className="ml-6 space-y-1.5 text-sm">
				{info.filesChanged.length > 0 && (
					<div className="flex items-center gap-1.5 opacity-80">
						<FileTextIcon className="size-1.5" />
						<span>
							{info.filesChanged.length} file{info.filesChanged.length !== 1 ? "s" : ""} changed
						</span>
					</div>
				)}

				{info.tokensUsed > 0 && <div className="opacity-70 text-xs">{info.tokensUsed.toLocaleString()} tokens used</div>}

				{hasErrors && (
					<div className="mt-2 pt-2 border-t border-warning/30">
						<div className="text-warning font-medium mb-1">Issues:</div>
						<ul className="list-disc list-inside text-xs opacity-80">
							{info.errors?.map((error, i) => (
								<li key={i}>{error}</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</div>
	)
})

BeadCompletedMessage.displayName = "BeadCompletedMessage"

/**
 * Renders a bead_failed message.
 */
export const BeadFailedMessage = memo(({ message }: BeadMessageProps) => {
	const info = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as BeadsmithSayBeadFailed
		} catch {
			return { beadNumber: 1, errors: ["Unknown error"], canRetry: false }
		}
	}, [message.text])

	return (
		<div className="bg-error/10 border border-error/30 rounded-sm py-2.5 px-3">
			<div className={HEADER_CLASSNAMES}>
				<XIcon className="size-2 text-error" />
				<span className="font-semibold text-error">Iteration {info.beadNumber} Failed</span>
			</div>

			<div className="ml-6 space-y-1.5">
				<ul className="list-disc list-inside text-sm opacity-80">
					{info.errors.map((error, i) => (
						<li key={i}>{error}</li>
					))}
				</ul>

				{info.canRetry && <div className="text-xs opacity-70 mt-2">The loop will retry with fresh context.</div>}
			</div>
		</div>
	)
})

BeadFailedMessage.displayName = "BeadFailedMessage"

/**
 * Renders a bead_review message (ask type).
 */
export const BeadReviewMessage = memo(({ message, isLast }: BeadMessageProps) => {
	const [isLoading, setIsLoading] = useState(false)
	const [showRejectInput, setShowRejectInput] = useState(false)
	const [rejectFeedback, setRejectFeedback] = useState("")

	const info = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as BeadsmithAskBeadReview
		} catch {
			return {
				beadNumber: 1,
				taskId: "",
				filesChanged: [],
				diff: "",
				impactSummary: undefined,
				testResults: undefined,
				commitHash: undefined,
			}
		}
	}, [message.text])

	const allTestsPassed = info.testResults?.every((t) => t.passed) ?? true
	const failedTests = info.testResults?.filter((t) => !t.passed) ?? []

	const handleApprove = useCallback(async () => {
		setIsLoading(true)
		try {
			await BeadServiceClient.approveBead(ApproveBeadRequest.create({}))
		} catch (error) {
			console.error("[BeadReview] Failed to approve:", error)
		} finally {
			setIsLoading(false)
		}
	}, [])

	const handleReject = useCallback(async () => {
		if (!showRejectInput) {
			setShowRejectInput(true)
			return
		}

		if (!rejectFeedback.trim()) {
			return // Require feedback
		}

		setIsLoading(true)
		try {
			await BeadServiceClient.rejectBead(
				RejectBeadRequest.create({
					feedback: rejectFeedback.trim(),
				}),
			)
			setShowRejectInput(false)
			setRejectFeedback("")
		} catch (error) {
			console.error("[BeadReview] Failed to reject:", error)
		} finally {
			setIsLoading(false)
		}
	}, [showRejectInput, rejectFeedback])

	const handleSkip = useCallback(async () => {
		setIsLoading(true)
		try {
			await BeadServiceClient.skipBead(EmptyRequest.create({}))
		} catch (error) {
			console.error("[BeadReview] Failed to skip:", error)
		} finally {
			setIsLoading(false)
		}
	}, [])

	const handleCancelReject = useCallback(() => {
		setShowRejectInput(false)
		setRejectFeedback("")
	}, [])

	return (
		<div className="bg-quote border border-editor-group-border rounded-sm py-2.5 px-3">
			<div className={HEADER_CLASSNAMES}>
				<LoaderCircleIcon className={cn("size-2", isLast && !isLoading && "animate-spin text-link")} />
				<span className="font-semibold">Review Bead #{info.beadNumber}</span>
			</div>

			<div className="ml-6 space-y-3">
				{/* Files Changed */}
				{info.filesChanged.length > 0 && (
					<div>
						<div className="text-sm font-medium mb-1 flex items-center gap-1.5">
							<FileTextIcon className="size-1.5" />
							Files Changed ({info.filesChanged.length})
						</div>
						<ul className="text-xs opacity-80 space-y-0.5">
							{info.filesChanged.slice(0, 5).map((file, i) => (
								<li className="flex items-center gap-1.5" key={i}>
									<span
										className={cn(
											"px-1 py-0.5 rounded text-[10px] font-medium",
											file.changeType === "created" && "bg-success/20 text-success",
											file.changeType === "modified" && "bg-link/20 text-link",
											file.changeType === "deleted" && "bg-error/20 text-error",
										)}>
										{file.changeType}
									</span>
									<span className="truncate">{file.filePath}</span>
									{(file.linesAdded || file.linesRemoved) && (
										<span className="text-[10px] opacity-60">
											{file.linesAdded && <span className="text-success">+{file.linesAdded}</span>}
											{file.linesAdded && file.linesRemoved && " "}
											{file.linesRemoved && <span className="text-error">-{file.linesRemoved}</span>}
										</span>
									)}
								</li>
							))}
							{info.filesChanged.length > 5 && (
								<li className="opacity-60">...and {info.filesChanged.length - 5} more</li>
							)}
						</ul>
					</div>
				)}

				{/* Impact Summary */}
				{info.impactSummary && (
					<div className="bg-warning/5 border border-warning/20 rounded-sm p-2">
						<div className="text-sm font-medium mb-2 flex items-center gap-1.5 text-warning">
							<CircleAlertIcon className="size-3.5" />
							Impact Analysis
						</div>
						<div className="text-xs space-y-2">
							{/* Confidence Breakdown */}
							{info.impactSummary.confidenceBreakdown && (
								<div className="flex items-center gap-3 pb-2 border-b border-warning/10">
									<span className="opacity-70">Edge Confidence:</span>
									<div className="flex items-center gap-2">
										{info.impactSummary.confidenceBreakdown.high > 0 && (
											<span className="px-1.5 py-0.5 bg-success/20 text-success rounded text-[10px] font-medium">
												{info.impactSummary.confidenceBreakdown.high} high
											</span>
										)}
										{info.impactSummary.confidenceBreakdown.medium > 0 && (
											<span className="px-1.5 py-0.5 bg-link/20 text-link rounded text-[10px] font-medium">
												{info.impactSummary.confidenceBreakdown.medium} med
											</span>
										)}
										{info.impactSummary.confidenceBreakdown.low > 0 && (
											<span className="px-1.5 py-0.5 bg-warning/20 text-warning rounded text-[10px] font-medium">
												{info.impactSummary.confidenceBreakdown.low} low
											</span>
										)}
										{info.impactSummary.confidenceBreakdown.unsafe > 0 && (
											<span className="px-1.5 py-0.5 bg-error/20 text-error rounded text-[10px] font-medium">
												{info.impactSummary.confidenceBreakdown.unsafe} unsafe
											</span>
										)}
									</div>
								</div>
							)}

							{/* Affected Files */}
							{info.impactSummary.affectedFiles.length > 0 && (
								<div>
									<div className="opacity-70 mb-1">Potentially affected files:</div>
									<div className="flex flex-wrap gap-1">
										{info.impactSummary.affectedFiles.slice(0, 5).map((file, i) => (
											<span
												className="px-1.5 py-0.5 bg-foreground/10 rounded text-[10px] truncate max-w-[150px]"
												key={i}
												title={file}>
												{file.split("/").pop()}
											</span>
										))}
										{info.impactSummary.affectedFiles.length > 5 && (
											<span className="px-1.5 py-0.5 text-[10px] opacity-60">
												+{info.impactSummary.affectedFiles.length - 5} more
											</span>
										)}
									</div>
								</div>
							)}

							{/* Affected Functions */}
							{info.impactSummary.affectedFunctions && info.impactSummary.affectedFunctions.length > 0 && (
								<div>
									<div className="opacity-70 mb-1">Affected functions:</div>
									<div className="flex flex-wrap gap-1">
										{info.impactSummary.affectedFunctions.slice(0, 5).map((fn, i) => (
											<span
												className="px-1.5 py-0.5 bg-link/10 text-link rounded text-[10px] font-mono"
												key={i}>
												{fn}
											</span>
										))}
										{info.impactSummary.affectedFunctions.length > 5 && (
											<span className="px-1.5 py-0.5 text-[10px] opacity-60">
												+{info.impactSummary.affectedFunctions.length - 5} more
											</span>
										)}
									</div>
								</div>
							)}

							{/* Suggested Tests */}
							{info.impactSummary.suggestedTests.length > 0 && (
								<div className="pt-2 border-t border-warning/10">
									<div className="opacity-70 mb-1">Suggested tests to run:</div>
									<div className="flex flex-wrap gap-1">
										{info.impactSummary.suggestedTests.slice(0, 4).map((test, i) => (
											<span
												className="px-1.5 py-0.5 bg-success/10 text-success rounded text-[10px]"
												key={i}>
												{test.split("/").pop()}
											</span>
										))}
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Test Results */}
				{info.testResults && info.testResults.length > 0 && (
					<div>
						<div className="text-sm font-medium mb-1 flex items-center gap-1.5">
							{allTestsPassed ? (
								<CheckIcon className="size-1.5 text-success" />
							) : (
								<XIcon className="size-1.5 text-error" />
							)}
							Tests: {allTestsPassed ? "All Passed" : `${failedTests.length} Failed`}
						</div>
						{!allTestsPassed && (
							<ul className="text-xs opacity-80 space-y-0.5">
								{failedTests.map((test, i) => (
									<li className="text-error" key={i}>
										{test.name}
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				{/* Commit Hash */}
				{info.commitHash && (
					<div className="flex items-center gap-1.5 text-xs opacity-70">
						<GitBranchIcon className="size-1.5" />
						<code className="bg-code rounded px-1 py-0.5">{info.commitHash.slice(0, 8)}</code>
					</div>
				)}

				{/* Approval Buttons (shown when this is the last message) */}
				{isLast && (
					<div className="mt-3 pt-3 border-t border-editor-group-border">
						{showRejectInput ? (
							<div className="space-y-2">
								<textarea
									autoFocus
									className="w-full p-2 text-sm bg-input border border-input-border rounded-sm resize-none focus:outline-none focus:border-link"
									disabled={isLoading}
									onChange={(e) => setRejectFeedback(e.target.value)}
									placeholder="Please explain why you're rejecting this bead..."
									rows={3}
									value={rejectFeedback}
								/>
								<div className="flex gap-2">
									<button
										className="flex items-center gap-1.5 px-3 py-1.5 bg-error/20 text-error border border-error/30 rounded-sm text-sm hover:bg-error/30 transition-colors disabled:opacity-50"
										disabled={isLoading || !rejectFeedback.trim()}
										onClick={handleReject}
										type="button">
										{isLoading ? (
											<LoaderCircleIcon className="size-1.5 animate-spin" />
										) : (
											<ThumbsDownIcon className="size-1.5" />
										)}
										Submit Rejection
									</button>
									<button
										className="px-3 py-1.5 text-sm opacity-70 hover:opacity-100 transition-opacity"
										disabled={isLoading}
										onClick={handleCancelReject}
										type="button">
										Cancel
									</button>
								</div>
							</div>
						) : (
							<div className="flex gap-2">
								<button
									className="flex items-center gap-1.5 px-3 py-1.5 bg-success/20 text-success border border-success/30 rounded-sm text-sm hover:bg-success/30 transition-colors disabled:opacity-50"
									disabled={isLoading}
									onClick={handleApprove}
									type="button">
									{isLoading ? (
										<LoaderCircleIcon className="size-1.5 animate-spin" />
									) : (
										<ThumbsUpIcon className="size-1.5" />
									)}
									Approve
								</button>
								<button
									className="flex items-center gap-1.5 px-3 py-1.5 bg-error/20 text-error border border-error/30 rounded-sm text-sm hover:bg-error/30 transition-colors disabled:opacity-50"
									disabled={isLoading}
									onClick={handleReject}
									type="button">
									<ThumbsDownIcon className="size-1.5" />
									Reject
								</button>
								<button
									className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground/10 text-foreground/70 border border-foreground/20 rounded-sm text-sm hover:bg-foreground/20 transition-colors disabled:opacity-50"
									disabled={isLoading}
									onClick={handleSkip}
									type="button">
									<SkipForwardIcon className="size-1.5" />
									Skip
								</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
})

BeadReviewMessage.displayName = "BeadReviewMessage"
