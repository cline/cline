import { AskResponseRequest } from "@shared/proto/cline/task"
import { CrosshairIcon, LoaderCircleIcon } from "lucide-react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

/**
 * Persistent chip above the composer while a /goal completion guard is
 * armed, so the user always knows a goal is active without asking for
 * status. Shows a spinner during the automatic post-run verification turn;
 * the ✕ clears the goal ("/goal off" — handled instantly by the controller,
 * even mid-turn, without starting a model turn).
 */
export function GoalBanner() {
	const { activeGoal } = useExtensionState()
	const [clearing, setClearing] = useState(false)

	if (!activeGoal) {
		return null
	}

	const clearGoal = () => {
		setClearing(true)
		TaskServiceClient.askResponse(
			AskResponseRequest.create({
				responseType: "messageResponse",
				text: "/goal off",
			}),
		)
			.catch((error) => {
				console.error("Failed to clear goal:", error)
			})
			.finally(() => {
				setClearing(false)
			})
	}

	return (
		<div className="mx-3 mt-2.5 flex items-center gap-2 rounded-xs border border-editor-group-border bg-code/70 px-2.5 py-1.5 text-xs shadow-xs">
			<CrosshairIcon aria-hidden="true" className="size-3 shrink-0 text-description" />
			<span className="min-w-0 flex-1 truncate" title={activeGoal.goal}>
				<span className="font-medium text-description">Goal: </span>
				<span className="text-foreground">{activeGoal.goal}</span>
			</span>
			{activeGoal.verifying && (
				<span className="flex shrink-0 items-center gap-1 text-description">
					<LoaderCircleIcon className="size-3 animate-spin" />
					Verifying…
				</span>
			)}
			<button
				aria-label="Clear goal"
				className="-my-1 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
				disabled={clearing}
				onClick={clearGoal}
				title="Clear goal (/goal off)"
				type="button">
				<span aria-hidden="true" className="codicon codicon-close text-[12px]" />
			</button>
		</div>
	)
}
