import { isTemporaryWorkspacePath } from "@cline/shared/browser";
import type { SessionThread } from "@/hooks/use-session-history";
import { normalizeWorkspacePath } from "@/lib/workspace-paths";

export const INITIAL_VISIBLE_THREAD_COUNT = 10;

export type SidebarProjectGroup = {
	id: string;
	label: string;
	workspacePath: string;
	threads: SessionThread[];
};

export function workspaceDisplayName(path: string): string {
	if (isTemporaryWorkspacePath(path)) return "New Project";
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return "";
	const segments = trimmed.split(/[\\/]/).filter(Boolean);
	return segments.at(-1) || trimmed;
}

function uniqueWorkspaceLabel(path: string, workspacePaths: string[]): string {
	if (!path) return "Other";
	const segments = path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const allSegments = workspacePaths.map((workspacePath) =>
		workspacePath
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.filter(Boolean),
	);
	for (let depth = 1; depth <= segments.length; depth += 1) {
		const candidate = segments.slice(-depth).join("/");
		const matches = allSegments.filter(
			(other) => other.slice(-depth).join("/") === candidate,
		).length;
		if (matches === 1) return candidate;
	}
	return path;
}

export function groupThreadsByProject(
	threads: SessionThread[],
): SidebarProjectGroup[] {
	const groups = new Map<
		string,
		{ workspacePath: string; threads: SessionThread[] }
	>();
	for (const thread of threads) {
		const workspacePath = thread.workspacePath.trim();
		const projectId = normalizeWorkspacePath(workspacePath) || "__other__";
		const current = groups.get(projectId);
		if (current) current.threads.push(thread);
		else groups.set(projectId, { workspacePath, threads: [thread] });
	}
	const workspacePaths = [...groups.values()].map(
		(group) => group.workspacePath,
	);
	return [...groups.entries()].map(([id, group]) => ({
		id,
		label: isTemporaryWorkspacePath(group.workspacePath)
			? "New Project"
			: uniqueWorkspaceLabel(group.workspacePath, workspacePaths),
		workspacePath: group.workspacePath,
		threads: group.threads,
	}));
}
