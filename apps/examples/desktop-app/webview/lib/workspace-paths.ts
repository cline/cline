export const WORKSPACE_SELECTION_STORAGE_KEY =
	"cline.code.workspace-selection.v1";

export type WorkspaceSelectionStorage = {
	lastWorkspace: string;
	workspaces: string[];
};

export function normalizeWorkspacePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		return "";
	}
	const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "");
	const normalized = withoutTrailingSeparators || trimmed[0] || "";
	return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function mergeWorkspacePaths(
	...pathGroups: ReadonlyArray<readonly string[]>
): string[] {
	const byNormalizedPath = new Map<string, string>();
	for (const paths of pathGroups) {
		for (const path of paths) {
			const trimmed = path.trim();
			const normalized = normalizeWorkspacePath(trimmed);
			if (normalized && !byNormalizedPath.has(normalized)) {
				byNormalizedPath.set(normalized, trimmed);
			}
		}
	}
	return [...byNormalizedPath.values()].sort((a, b) => a.localeCompare(b));
}

export function parseWorkspaceSelectionStorage(
	raw: string | null,
): WorkspaceSelectionStorage {
	if (!raw) {
		return { lastWorkspace: "", workspaces: [] };
	}
	try {
		const parsed = JSON.parse(raw) as {
			lastWorkspace?: unknown;
			workspaces?: unknown;
		};
		const lastWorkspace =
			typeof parsed?.lastWorkspace === "string"
				? parsed.lastWorkspace.trim()
				: "";
		const workspaces = Array.isArray(parsed?.workspaces)
			? parsed.workspaces.filter(
					(workspace): workspace is string => typeof workspace === "string",
				)
			: [];
		return {
			lastWorkspace,
			workspaces: mergeWorkspacePaths(workspaces, [lastWorkspace]),
		};
	} catch {
		return { lastWorkspace: "", workspaces: [] };
	}
}

export function readWorkspaceSelectionFromWindow(): WorkspaceSelectionStorage {
	if (typeof window === "undefined") {
		return { lastWorkspace: "", workspaces: [] };
	}
	try {
		return parseWorkspaceSelectionStorage(
			window.localStorage.getItem(WORKSPACE_SELECTION_STORAGE_KEY),
		);
	} catch {
		return { lastWorkspace: "", workspaces: [] };
	}
}

export function writeWorkspaceSelectionToWindow(
	value: WorkspaceSelectionStorage,
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			WORKSPACE_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastWorkspace: value.lastWorkspace.trim(),
				workspaces: mergeWorkspacePaths(value.workspaces, [
					value.lastWorkspace,
				]),
			}),
		);
	} catch {
		// Keep workspace switching functional when storage is unavailable.
	}
}
