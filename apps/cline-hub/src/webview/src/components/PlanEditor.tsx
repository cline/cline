import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moveTask } from "./planEditorLogic";

export type PlanEditorTask = {
	id: string;
	title: string;
};

export type PlanEditorProps = {
	planId: string | null;
	planTitle: string | null;
	tasks: PlanEditorTask[];
	disabled?: boolean;
	onReorder: (taskIds: string[]) => void;
	onRemove: (taskId: string) => void;
	onAdd: (task: PlanEditorTask) => void;
	className?: string;
};

export { moveTask, removeTask } from "./planEditorLogic";

export function PlanEditor({
	planId,
	planTitle,
	tasks,
	disabled,
	onReorder,
	onRemove,
	onAdd,
	className,
}: PlanEditorProps) {
	if (!planId) {
		return null;
	}

	const ids = tasks.map((task) => task.id);

	return (
		<div
			className={cn("space-y-2 rounded-md border bg-background p-3", className)}
			data-slot="plan-editor"
		>
			<div className="text-xs font-medium">
				Plan · {planTitle ?? planId}
			</div>
			<ul className="space-y-1">
				{tasks.map((task, index) => (
					<li
						className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
						key={task.id}
					>
						<span className="min-w-0 flex-1 truncate">{task.title}</span>
						<Button
							disabled={disabled || index === 0}
							onClick={() => onReorder(moveTask(ids, task.id, "up"))}
							size="sm"
							type="button"
							variant="ghost"
							className="h-6 px-1"
						>
							↑
						</Button>
						<Button
							disabled={disabled || index === tasks.length - 1}
							onClick={() => onReorder(moveTask(ids, task.id, "down"))}
							size="sm"
							type="button"
							variant="ghost"
							className="h-6 px-1"
						>
							↓
						</Button>
						<Button
							disabled={disabled}
							onClick={() => onRemove(task.id)}
							size="sm"
							type="button"
							variant="ghost"
							className="h-6 px-1"
						>
							✕
						</Button>
					</li>
				))}
			</ul>
			<Button
				disabled={disabled}
				onClick={() => {
					const id = `t-${tasks.length + 1}`;
					onAdd({ id, title: `Task ${tasks.length + 1}` });
				}}
				size="sm"
				type="button"
				variant="outline"
				className="h-7 text-xs"
			>
				Add task
			</Button>
		</div>
	);
}
