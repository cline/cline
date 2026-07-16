export const WORKSPACE_SELECTION_STORAGE_KEY =
	"cline.code.workspace-selection.v1";

export type WorkspaceSelectionStorage = {
	lastWorkspace: string;
	workspaces: string[];
};

export type WorkspacePathSource = {
	cwd?: string;
	workspaceRoot?: string;
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

const POSIX_HOME_OR_DESKTOP_PATTERN =
	/^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?:\/Desktop)?$/;
const WINDOWS_HOME_OR_DESKTOP_PATTERN =
	/^[a-z]:[\\/]users[\\/][^\\/]+(?:[\\/]desktop)?$/i;

/**
 * Sessions can run anywhere (Cline-internal worktrees and plugin installs
 * under `.cline`, or a shell's default cwd like the home or Desktop
 * directory), but those locations are not projects to offer in the
 * workspace catalog. The active workspace root is registered separately,
 * so an explicitly opened directory still shows while selected.
 */
export function isExcludedWorkspacePath(path: string): boolean {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) {
		return false;
	}
	if (normalized.split(/[\\/]/).includes(".cline")) {
		return true;
	}
	return (
		POSIX_HOME_OR_DESKTOP_PATTERN.test(normalized) ||
		WINDOWS_HOME_OR_DESKTOP_PATTERN.test(normalized)
	);
}

export function filterWorkspacePaths(paths: readonly string[]): string[] {
	return paths.filter((path) => !isExcludedWorkspacePath(path));
}

export function workspacePathsFromSessions(
	sessions: readonly WorkspacePathSource[],
): string[] {
	return filterWorkspacePaths(
		mergeWorkspacePaths(
			sessions.map((session) => session.workspaceRoot || session.cwd || ""),
		),
	);
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
			workspaces: filterWorkspacePaths(
				mergeWorkspacePaths(workspaces, [lastWorkspace]),
			),
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
				workspaces: filterWorkspacePaths(
					mergeWorkspacePaths(value.workspaces, [value.lastWorkspace]),
				),
			}),
		);
	} catch {
		// Keep workspace switching functional when storage is unavailable.
	}
}
