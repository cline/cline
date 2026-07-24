import { isChatWorkspacePath } from "@cline/shared/browser";

export const WORKSPACE_SELECTION_STORAGE_KEY =
	"cline.code.workspace-selection.v1";

export type WorkspaceSelectionStorage = {
	lastWorkspace: string;
	workspaces: string[];
};

export type WorkspacePathSource = {
	cwd?: string;
	workspaceRoot?: string;
	startedAt?: string;
	endedAt?: string;
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

/**
 * Dedupes paths across groups, keeping the first spelling seen and the
 * first-seen position, so callers control the ranking (e.g. session recency)
 * through argument order.
 */
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
	return [...byNormalizedPath.values()];
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/;

export function isAbsoluteFilePath(path: string): boolean {
	return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

/**
 * Diff tool outputs carry paths as the agent wrote them — sometimes absolute,
 * sometimes relative to the session cwd. The webview has no `node:path`, so
 * relative paths are joined against the cwd with the separator style the cwd
 * already uses.
 */
export function resolveWorkspaceFilePath(path: string, cwd?: string): string {
	const trimmed = path.trim();
	const base = (cwd ?? "").trim();
	if (!trimmed || !base || isAbsoluteFilePath(trimmed)) {
		return trimmed;
	}
	const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${trimmed.replace(/^\.\//, "")}`;
}

const POSIX_HOME_OR_DESKTOP_PATTERN =
	/^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?:\/Desktop)?$/;
const WINDOWS_HOME_OR_DESKTOP_PATTERN =
	/^[a-z]:[\\/]users[\\/][^\\/]+(?:[\\/]desktop)?$/i;

let hostHomePath = "";

/**
 * The webview bundle has no usable `process.env`, so standard home locations
 * are matched by the patterns above and the sidecar reports the real host
 * home directory through `get_process_context` to cover non-standard ones.
 */
export function registerHostHomeDirectory(path: string): void {
	hostHomePath = normalizeWorkspacePath(path);
}

function isRegisteredHomeOrDesktop(normalized: string): boolean {
	if (!hostHomePath) {
		return false;
	}
	if (normalized === hostHomePath) {
		return true;
	}
	return (
		normalized.startsWith(hostHomePath) &&
		/^[\\/]desktop$/i.test(normalized.slice(hostHomePath.length))
	);
}

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
	if (isChatWorkspacePath(normalized)) {
		return true;
	}
	if (normalized.split(/[\\/]/).includes(".cline")) {
		return true;
	}
	return (
		isRegisteredHomeOrDesktop(normalized) ||
		POSIX_HOME_OR_DESKTOP_PATTERN.test(normalized) ||
		WINDOWS_HOME_OR_DESKTOP_PATTERN.test(normalized)
	);
}

export function filterWorkspacePaths(paths: readonly string[]): string[] {
	return paths.filter((path) => !isExcludedWorkspacePath(path));
}

/**
 * Workspaces with the most recent session activity come first; paths whose
 * sessions carry no parseable timestamp fall back to alphabetical order at
 * the end.
 */
export function workspacePathsFromSessions(
	sessions: readonly WorkspacePathSource[],
): string[] {
	const lastActivityByPath = new Map<string, number>();
	for (const session of sessions) {
		const normalized = normalizeWorkspacePath(
			session.workspaceRoot || session.cwd || "",
		);
		if (!normalized) {
			continue;
		}
		const activity = Date.parse(session.endedAt ?? session.startedAt ?? "");
		if (Number.isNaN(activity)) {
			continue;
		}
		const known = lastActivityByPath.get(normalized);
		if (known === undefined || activity > known) {
			lastActivityByPath.set(normalized, activity);
		}
	}
	return filterWorkspacePaths(
		mergeWorkspacePaths(
			sessions.map((session) => session.workspaceRoot || session.cwd || ""),
		),
	).sort((a, b) => {
		const aTime = lastActivityByPath.get(normalizeWorkspacePath(a)) ?? 0;
		const bTime = lastActivityByPath.get(normalizeWorkspacePath(b)) ?? 0;
		return bTime === aTime ? a.localeCompare(b) : bTime - aTime;
	});
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
		const parsedLastWorkspace =
			typeof parsed?.lastWorkspace === "string"
				? parsed.lastWorkspace.trim()
				: "";
		const lastWorkspace = isChatWorkspacePath(parsedLastWorkspace)
			? ""
			: parsedLastWorkspace;
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
		const lastWorkspace = isChatWorkspacePath(value.lastWorkspace)
			? ""
			: value.lastWorkspace.trim();
		window.localStorage.setItem(
			WORKSPACE_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastWorkspace,
				workspaces: filterWorkspacePaths(
					mergeWorkspacePaths(value.workspaces, [lastWorkspace]),
				),
			}),
		);
	} catch {
		// Keep workspace switching functional when storage is unavailable.
	}
}
