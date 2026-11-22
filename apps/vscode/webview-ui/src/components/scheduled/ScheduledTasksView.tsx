import { RunScheduledTaskRequest, UpdateScheduledTasksRequest } from "@shared/proto/cline/task"
import { createScheduledTaskId, MAX_SCHEDULED_TASKS, type ScheduledTask } from "@shared/scheduled-next-task"
import { PlusIcon } from "lucide-react"
import { useCallback, useState } from "react"
import ViewHeader from "@/components/common/ViewHeader"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderListings } from "@/hooks/useProviderListings"
import { TaskServiceClient } from "@/services/grpc-client"
import { ScheduledTaskRow, scheduledTaskToProto } from "./ScheduledTaskRow"

/**
 * The "Scheduled Tasks" page: a queue of chats to start as tasks complete, shown
 * in the root view (it replaces the chat, exactly like History or Settings) rather
 * than as a popup, because the list needs room to be reordered and edited.
 *
 * Three rules the whole page is built around:
 *   - the order on screen IS the run order — the top row goes first;
 *   - the pause switch at the top stops every queued chat from starting without
 *     throwing the queue away;
 *   - "New scheduled task" appends a row below the existing ones, so adding never
 *     changes what runs next.
 *
 * Every edit writes the whole queue back (`updateScheduledTasks`), so a reorder,
 * a delete and an edit are the same one call and can never disagree with each
 * other.
 */
const ScheduledTasksView = ({ onDone }: { onDone: () => void }) => {
	const {
		environment,
		mode: currentMode,
		includePreviousTaskSummary,
		scheduledTasks,
		scheduledTasksPaused,
		navigateToChat,
	} = useExtensionState()
	const { providers } = useProviderListings()
	const [isSaving, setIsSaving] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)

	const tasks = scheduledTasks ?? []
	const paused = scheduledTasksPaused === true

	const save = useCallback(async (next: ScheduledTask[], nextPaused?: boolean) => {
		setIsSaving(true)
		setError(undefined)
		try {
			await TaskServiceClient.updateScheduledTasks(
				UpdateScheduledTasksRequest.create({
					tasks: next.map(scheduledTaskToProto),
					...(nextPaused === undefined ? {} : { paused: nextPaused }),
				}),
			)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save the scheduled tasks")
		} finally {
			setIsSaving(false)
		}
	}, [])

	// A new row starts at the end of the queue: the chat running next is never
	// silently replaced by something the user just typed.
	const addTask = useCallback(() => {
		const task: ScheduledTask = {
			id: createScheduledTaskId(),
			message: "",
			mode: currentMode === "plan" ? "plan" : "act",
			includeSummary: includePreviousTaskSummary ?? true,
			createdAt: Date.now(),
		}
		void save([...tasks, task])
	}, [currentMode, includePreviousTaskSummary, save, tasks])

	const patchTask = useCallback(
		(id: string, patch: Partial<ScheduledTask>) => {
			void save(tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
		},
		[save, tasks],
	)

	const deleteTask = useCallback(
		(id: string) => {
			void save(tasks.filter((task) => task.id !== id))
		},
		[save, tasks],
	)

	// Reordering is the only way the run order changes, so the swap is guarded on
	// both ends and written back as the whole queue.
	const moveTask = useCallback(
		(id: string, direction: "up" | "down") => {
			const from = tasks.findIndex((task) => task.id === id)
			const to = direction === "up" ? from - 1 : from + 1
			if (from < 0 || to < 0 || to >= tasks.length) {
				return
			}
			const next = [...tasks]
			const [row] = next.splice(from, 1)
			if (row) {
				next.splice(to, 0, row)
			}
			void save(next)
		},
		[save, tasks],
	)

	const runNow = useCallback(
		async (id: string) => {
			setError(undefined)
			try {
				await TaskServiceClient.runScheduledTaskNow(RunScheduledTaskRequest.create({ scheduledTaskId: id }))
				// The chat that just started is the thing to look at, and the row is
				// already spent, so leave the queue view behind.
				navigateToChat?.()
			} catch (err) {
				setError(err instanceof Error ? err.message : "Could not start the scheduled task")
			}
		},
		[navigateToChat],
	)

	return (
		<div className="fixed inset-0 flex w-full flex-col overflow-hidden">
			<ViewHeader environment={environment} onDone={onDone} title="Scheduled Tasks" />

			{/* Pause lives above the list: it governs the whole queue, not one row. */}
			<div className="flex flex-col gap-3 px-5 pb-3">
				<div className="flex items-center justify-between gap-3 rounded-md border border-border bg-editor-section-background p-3">
					<div className="flex flex-col gap-0.5">
						<Label htmlFor="scheduled-tasks-pause">Pause scheduled tasks</Label>
						<span className="text-xs text-description" data-testid="scheduled-tasks-pause-hint">
							{paused
								? "Paused — queued chats will not start when the current chat finishes."
								: "Running — the first chat in the list starts when the current chat finishes."}
						</span>
					</div>
					<Switch
						checked={paused}
						data-testid="scheduled-tasks-pause"
						id="scheduled-tasks-pause"
						onCheckedChange={(checked) => void save(tasks, checked)}
						size="lg"
					/>
				</div>

				<div className="flex items-center justify-between gap-3">
					<span className="text-xs text-description" data-testid="scheduled-tasks-summary">
						{tasks.length === 0
							? "Nothing scheduled."
							: `${tasks.length} scheduled chat${tasks.length === 1 ? "" : "s"}, run in the order shown${isSaving ? " · saving…" : ""}`}
					</span>
					<Button
						data-testid="scheduled-task-add"
						disabled={tasks.length >= MAX_SCHEDULED_TASKS}
						onClick={addTask}
						size="sm"
						variant="secondary">
						<PlusIcon />
						New scheduled task
					</Button>
				</div>

				{error && (
					<span className="text-xs text-error" data-testid="scheduled-tasks-error">
						{error}
					</span>
				)}
			</div>

			<div className="flex-grow overflow-y-auto px-5 pb-5">
				{tasks.length === 0 ? (
					<div className="mt-6 text-center text-xs text-description" data-testid="scheduled-tasks-empty">
						Queue a chat to start when the current chat finishes. The order here is the order they run in.
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{tasks.map((task, index) => (
							<ScheduledTaskRow
								index={index}
								key={task.id}
								onDelete={() => deleteTask(task.id)}
								onMove={(direction) => moveTask(task.id, direction)}
								onPatch={(patch) => patchTask(task.id, patch)}
								onRunNow={() => void runNow(task.id)}
								providers={providers}
								task={task}
								total={tasks.length}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export default ScheduledTasksView
