import { CalendarClockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

/**
 * Standalone-navbar entry for the "Scheduled Tasks" queue, placed directly beside
 * "New Task" because both decide what the next chat is. It opens the queue page —
 * the same one the VS Code panel's actions-row button opens — and shows how many
 * chats are waiting, so the queue stays visible without opening anything.
 */
export const ScheduleNextTaskButton = () => {
	const { scheduledTasks, navigateToScheduledTasks } = useExtensionState()
	const queuedCount = scheduledTasks?.length ?? 0

	return (
		<Tooltip>
			<TooltipContent side="bottom">
				{queuedCount > 0
					? `${queuedCount} scheduled chat${queuedCount === 1 ? "" : "s"} — they start in the order listed as tasks complete.`
					: "Schedule chats to run as tasks complete: message, Plan or Act mode, provider and model."}
			</TooltipContent>
			<TooltipTrigger asChild>
				<Button
					aria-label="Scheduled Tasks"
					aria-pressed={queuedCount > 0}
					className={cn("relative p-0 h-7", queuedCount > 0 && "bg-accent/25 text-foreground")}
					data-testid="tab-schedule-next-task"
					onClick={navigateToScheduledTasks}
					size="icon"
					variant="icon">
					<CalendarClockIcon className="stroke-1 [svg]:size-4" size={18} />
					{queuedCount > 0 && (
						<span
							className="absolute translate-x-3 -translate-y-3 rounded-full bg-button-background px-1 text-[10px] leading-3"
							data-testid="tab-schedule-next-task-count">
							{queuedCount}
						</span>
					)}
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}
