/** Pure helpers used by the plan editor and tests. */
export function moveTask(
	taskIds: string[],
	taskId: string,
	direction: "up" | "down",
): string[] {
	const index = taskIds.indexOf(taskId);
	if (index < 0) {
		return [...taskIds];
	}
	const target = direction === "up" ? index - 1 : index + 1;
	if (target < 0 || target >= taskIds.length) {
		return [...taskIds];
	}
	const next = [...taskIds];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item!);
	return next;
}

export function removeTask(taskIds: string[], taskId: string): string[] {
	return taskIds.filter((id) => id !== taskId);
}
