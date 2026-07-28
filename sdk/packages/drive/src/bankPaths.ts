/** Mirrors @cline/shared DRIVE_BANK_ROOT — value import banned by boundary. */
const DRIVE_BANK_ROOT = ".drive/bank";

export function bankRoot(workspaceRoot: string): string {
	return joinPath(workspaceRoot, DRIVE_BANK_ROOT);
}

export function taskPath(workspaceRoot: string, taskId: string): string {
	return joinPath(bankRoot(workspaceRoot), "tasks", `${taskId}.md`);
}

export function planPath(workspaceRoot: string, planId: string): string {
	return joinPath(bankRoot(workspaceRoot), "plans", `${planId}.plan.md`);
}

export function archivedTaskPath(
	workspaceRoot: string,
	taskId: string,
): string {
	return joinPath(bankRoot(workspaceRoot), "archive", "tasks", `${taskId}.md`);
}

export function archivedPlanPath(
	workspaceRoot: string,
	planId: string,
): string {
	return joinPath(
		bankRoot(workspaceRoot),
		"archive",
		"plans",
		`${planId}.plan.md`,
	);
}

function joinPath(...parts: string[]): string {
	return parts
		.map((part, index) => {
			if (index === 0) {
				return part.replace(/[\\/]+$/, "");
			}
			return part.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
		})
		.filter((part) => part.length > 0)
		.join("/");
}
