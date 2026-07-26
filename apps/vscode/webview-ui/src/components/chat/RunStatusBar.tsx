import type { AgentRunState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { CheckCircle2Icon, CircleXIcon, Clock3Icon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { memo, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ModelsServiceClient } from "@/services/grpc-client"

function statusLabel(run: AgentRunState): string {
	switch (run.phase) {
		case "idle":
			return ""
		case "submitting":
			return "Sending…"
		case "awaitingFirstEvent":
			return "Waiting for Bedrock…"
		case "streaming":
			return "Streaming…"
		case "waitingForApproval":
			return run.currentToolName === "ask_question" ? "Waiting for your answer" : "Waiting for approval"
		case "runningTool":
			return run.currentToolName ? `Running ${run.currentToolName}` : "Running tool"
		case "cancelling":
			return "Cancelling…"
		case "completed":
			return "Completed"
		case "cancelled":
			return "Cancelled"
		case "failed":
			return run.failure?.message || "Failed"
	}
}

function elapsedLabel(startedAt: number | undefined, now: number): string {
	if (!startedAt) return ""
	const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds}s`
}

export const RunStatusBar = memo(({ run }: { run?: AgentRunState }) => {
	const [now, setNow] = useState(Date.now())
	const active = run && !["idle", "completed", "cancelled", "failed"].includes(run.phase)

	useEffect(() => {
		if (!active) return
		const timer = setInterval(() => setNow(Date.now()), 1_000)
		return () => clearInterval(timer)
	}, [active])

	const elapsed = useMemo(() => elapsedLabel(run?.startedAt, now), [run?.startedAt, now])
	if (!run || run.phase === "idle") return null

	const icon =
		run.phase === "completed" ? (
			<CheckCircle2Icon className="size-3 text-success" />
		) : run.phase === "cancelled" ? (
			<CircleXIcon className="size-3 text-description" />
		) : run.phase === "failed" ? (
			<TriangleAlertIcon className="size-3 text-error" />
		) : (
			<LoaderCircleIcon className="size-3 animate-spin text-link" />
		)

	return (
		<div className="mx-3 mb-2 rounded-sm border border-editor-group-border bg-code px-2.5 py-2 text-xs">
			<div className="flex items-center gap-2">
				{icon}
				<span className="min-w-0 flex-1 truncate font-medium">{statusLabel(run)}</span>
				{elapsed && (
					<span className="flex shrink-0 items-center gap-1 text-description">
						<Clock3Icon className="size-3" />
						{elapsed}
					</span>
				)}
			</div>
			{run.phase === "failed" && run.failure && (
				<details className="mt-2 text-description">
					<summary className="cursor-pointer select-none">Error details</summary>
					<div className="mt-1 space-y-1 break-words">
						<div>
							{[run.failure.source, run.failure.category, run.failure.code, run.failure.httpStatus]
								.filter((value) => value !== undefined)
								.join(" · ")}
						</div>
						{run.failure.requestId && <div>Request ID: {run.failure.requestId}</div>}
						{run.failure.details && <pre className="m-0 whitespace-pre-wrap">{run.failure.details}</pre>}
						<Button
							className="h-auto px-0 py-1 text-xs"
							onClick={() => void ModelsServiceClient.openBedrockDiagnosticLog(EmptyRequest.create({}))}
							size="sm"
							variant="text">
							Open diagnostic log
						</Button>
					</div>
				</details>
			)}
		</div>
	)
})

RunStatusBar.displayName = "RunStatusBar"
