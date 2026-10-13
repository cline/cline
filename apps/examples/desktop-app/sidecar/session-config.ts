import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

function resolveWorkspacePath(
	path: string,
	environment: "local" | "ssh",
): string {
	if (environment === "ssh") return resolve(path);
	try {
		return realpathSync.native(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return resolve(path);
		throw error;
	}
}

export function workspacePathsOverlap(
	path: string | undefined,
	root: string,
	environment: "local" | "ssh",
): boolean {
	if (!path) return false;
	const resolved = resolveWorkspacePath(path, environment);
	const parent = resolveWorkspacePath(root, environment);
	return (
		resolved === parent ||
		resolved.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`) ||
		parent.startsWith(resolved.endsWith(sep) ? resolved : `${resolved}${sep}`)
	);
}

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
