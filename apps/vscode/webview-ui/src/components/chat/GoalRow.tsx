import type { ClineGoalInfo, ClineMessage } from "@shared/ExtensionMessage"
import { CircleCheckIcon, CircleSlashIcon, CrosshairIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function parseGoalInfo(text: string | undefined): ClineGoalInfo | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text)
		if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") {
			return parsed as ClineGoalInfo
		}
	} catch {
		// Fall through to undefined for malformed payloads.
	}
	return undefined
}

/**
 * Lifecycle row for the /goal completion guard — the webview counterpart of
 * the CLI's inline goal replies. "set" and "completed" get a titled card so
 * the guard arming and the verified completion stand out in the transcript;
 * "status" and "cleared" render as compact divider-style rows.
 */
export const GoalRow = ({ message }: { message: ClineMessage }) => {
	const info = parseGoalInfo(message.text)
	if (!info) {
		// Virtuoso cannot handle zero-height items; render a spacer instead of null.
		return <div aria-hidden className="h-px" />
	}

	if (info.kind === "set" || info.kind === "completed") {
		const isCompleted = info.kind === "completed"
		return (
			<div
				className={cn("my-1 rounded-xs border px-2.5 py-2", {
					"border-editor-group-border bg-code/70": !isCompleted,
					"border-success/40 bg-success/10": isCompleted,
				})}>
				<div
					className={cn("flex items-center gap-1.5 text-xs font-medium", {
						"text-description": !isCompleted,
						"text-success": isCompleted,
					})}>
					{isCompleted ? (
						<CircleCheckIcon className="size-3 shrink-0" />
					) : (
						<CrosshairIcon className="size-3 shrink-0" />
					)}
					<span>{isCompleted ? "Goal completed" : "Goal set"}</span>
				</div>
				<div className="mt-1 break-words text-foreground">{info.goal}</div>
				{isCompleted && info.summary && <div className="mt-1 break-words text-description">{info.summary}</div>}
				{!isCompleted && (
					<div className="mt-1 text-description">
						Cline verifies completion after every run until this goal is done. Use /goal off to clear it.
					</div>
				)}
			</div>
		)
	}

	// "status" and "cleared": compact divider-style rows (mirrors CompactionRow).
	const text = info.kind === "cleared" ? (info.detail ?? "Goal cleared.") : (info.detail ?? "")
	return (
		<div className="flex items-center gap-2 py-1.5 text-description">
			{info.kind === "cleared" ? (
				<CircleSlashIcon className="size-2 shrink-0" />
			) : (
				<CrosshairIcon className="size-2 shrink-0" />
			)}
			<span className="min-w-0 whitespace-pre-wrap">{text}</span>
			<div className="flex-1 min-w-4 border-t border-description/30" />
		</div>
	)
}

export default GoalRow
