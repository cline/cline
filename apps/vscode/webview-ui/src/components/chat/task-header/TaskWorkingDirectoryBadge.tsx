import type { Platform } from "@shared/ExtensionMessage"
import type { WorkspaceRoot } from "@shared/multi-root/types"
import { FolderIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Normalizes a path for comparison only, with platform-aware semantics that
 * match the extension host's `arePathsEqual` in src/utils/path.ts:
 * - win32: backslashes are separators; comparison is case-insensitive.
 * - everything else (including darwin and "unknown"): strict —
 *   case-sensitive and backslash is an ordinary filename character.
 *
 * darwin is deliberately strict even though the default APFS volume is
 * case-insensitive: macOS volumes can be case-sensitive, and for a warning
 * badge a rare spurious warning is better than silently hiding a real
 * mismatch. This also keeps the policy identical to `arePathsEqual`.
 */
function normalizeForComparison(p: string, platform: Platform): string {
	let normalized = p.trim()
	if (platform === "win32") {
		normalized = normalized.replace(/\\/g, "/").toLowerCase()
	}
	while (normalized.length > 1 && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

/**
 * True when the task's working directory is neither one of the open
 * workspace roots nor inside one of them. Returns false when either side is
 * unknown (no cwd recorded, or roots not yet initialized) so the badge never
 * shows a false alarm.
 */
export function isTaskCwdOutsideWorkspace(
	taskCwd: string | undefined,
	workspaceRoots: WorkspaceRoot[] | undefined,
	platform: Platform,
): boolean {
	const cwd = taskCwd?.trim()
	if (!cwd || !workspaceRoots || workspaceRoots.length === 0) {
		return false
	}
	const normalizedCwd = normalizeForComparison(cwd, platform)
	return !workspaceRoots.some((root) => {
		const rootPath = normalizeForComparison(root.path ?? "", platform)
		if (rootPath.length === 0) {
			return false
		}
		// A root may already end with a separator (e.g. "/" or "C:/").
		const containmentPrefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`
		return normalizedCwd === rootPath || normalizedCwd.startsWith(containmentPrefix)
	})
}

function basename(p: string, platform: Platform): string {
	let cleaned = p
	if (platform === "win32") {
		cleaned = cleaned.replace(/\\/g, "/")
	}
	cleaned = cleaned.replace(/\/+$/, "")
	return cleaned.split("/").pop() || p
}

/**
 * Persistent task-header chip shown when a task's working directory lies
 * outside the folder(s) open in this window (e.g. a task resumed from the
 * CLI or from another workspace). Cline reads, edits, and runs commands in
 * the task's own cwd, so the mismatch must stay visible for the whole task.
 */
const TaskWorkingDirectoryBadge: React.FC<{
	taskCwd?: string
	workspaceRoots?: WorkspaceRoot[]
	platform: Platform
}> = ({ taskCwd, workspaceRoots, platform }) => {
	if (!isTaskCwdOutsideWorkspace(taskCwd, workspaceRoots ?? [], platform)) {
		return null
	}
	const cwd = (taskCwd ?? "").trim()

	return (
		<Tooltip>
			<TooltipContent className="max-w-xs" side="bottom">
				This task's working directory is {cwd}, which is outside the current workspace. Cline reads and edits files and
				runs commands there.
			</TooltipContent>
			<TooltipTrigger className="flex items-center min-w-0">
				<div
					aria-label={`Task working directory ${cwd} is outside the current workspace`}
					className="mx-1 px-1.5 py-0.25 rounded-full inline-flex items-center gap-1 min-w-0 max-w-32 border border-(--vscode-editorWarning-foreground)/60 text-(--vscode-editorWarning-foreground)"
					id="task-cwd-badge">
					<FolderIcon className="shrink-0" size={11} />
					<span className="text-xs whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
						{basename(cwd, platform)}
					</span>
				</div>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default TaskWorkingDirectoryBadge
