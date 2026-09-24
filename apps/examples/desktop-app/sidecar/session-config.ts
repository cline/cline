import { resolve } from "node:path";

type WorkspacePathSource = {
	cwd?: unknown;
	workspaceRoot?: unknown;
	workspace_root?: unknown;
};

export function readWorkspacePath(
	source: WorkspacePathSource | undefined,
): string | undefined {
	const cwd = typeof source?.cwd === "string" ? source.cwd.trim() : "";
	if (cwd) return cwd;
	const workspaceRoot =
		typeof source?.workspaceRoot === "string"
			? source.workspaceRoot.trim()
			: "";
	if (workspaceRoot) return workspaceRoot;
	const snakeCaseWorkspaceRoot =
		typeof source?.workspace_root === "string"
			? source.workspace_root.trim()
			: "";
	return snakeCaseWorkspaceRoot || undefined;
}

export function workspacePathKey(
	source: WorkspacePathSource | undefined,
): string | undefined {
	const workspacePath = readWorkspacePath(source);
	return workspacePath ? resolve(workspacePath) : undefined;
}

export function readReasoningEffort(
	value: unknown,
): "low" | "medium" | "high" | "xhigh" | undefined {
	if (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	) {
		return value;
	}
	return undefined;
}
