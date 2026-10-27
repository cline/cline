/** The task branch prescribed by Cloud session creation, not its starting branch. */
export function cloudTaskBranch(
	taskId?: string,
	remoteSessionId?: string,
): string | undefined {
	const id = taskId?.trim() || remoteSessionId?.trim();
	return id ? `cline/${id.slice(-8).toLowerCase()}` : undefined;
}
