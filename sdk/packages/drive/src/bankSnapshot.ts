import type { BankSnapshot, DrivePlan, DriveTask } from "@cline/shared";

export function deriveBankSnapshot(
	plan: DrivePlan | null,
	tasksById: ReadonlyMap<string, DriveTask>,
): BankSnapshot {
	if (!plan || plan.status !== "active") {
		return emptySnapshot();
	}

	const openTaskIds: string[] = [];
	const openTitles: string[] = [];
	for (const taskId of plan.taskIds) {
		const task = tasksById.get(taskId);
		if (!task) {
			continue;
		}
		if (task.status === "open" || task.status === "in_progress") {
			openTaskIds.push(task.id);
			openTitles.push(task.title);
		}
	}

	const nowTaskId = openTaskIds[0] ?? null;
	const nextTaskId = openTaskIds[1] ?? null;

	return {
		activePlanId: plan.id,
		openTaskIds,
		nowTaskId,
		nextTaskId,
		nowTitle: openTitles[0] ?? null,
		nextTitle: openTitles[1] ?? null,
	};
}

function emptySnapshot(): BankSnapshot {
	return {
		activePlanId: null,
		openTaskIds: [],
		nowTaskId: null,
		nextTaskId: null,
		nowTitle: null,
		nextTitle: null,
	};
}
