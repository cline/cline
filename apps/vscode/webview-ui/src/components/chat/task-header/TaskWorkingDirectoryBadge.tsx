import type { WorkspaceRoot } from "@shared/multi-root/types"
import { FolderIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Normalizes a path for comparison only: forward slashes, no trailing
 * separator, lowercased. Lowercasing trades exactness on case-sensitive
 * filesystems for no false positives on Windows/macOS; acceptable for an
 * informational badge.
 */
function normalizeForComparison(p: string): string {
	let normalized = p.replace(/\\/g, "/").trim()
	while (normalized.length > 1 && normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1)
	}
	return normalized.toLowerCase()
}

/**
 * True when the task's working directory is neither one of the open
 * workspace roots nor inside one of them. Returns false when either side is
 * unknown (no cwd recorded, or roots not yet initialized) so the badge never
 * shows a false alarm.
 */
export function isTaskCwdOutsideWorkspace(taskCwd: string | undefined, workspaceRoots: WorkspaceRoot[] | undefined): boolean {
	const cwd = taskCwd?.trim()
	if (!cwd || !workspaceRoots || workspaceRoots.length === 0) {
		return false
	}
	const normalizedCwd = normalizeForComparison(cwd)
	return !workspaceRoots.some((root) => {
		const rootPath = normalizeForComparison(root.path ?? "")
		return rootPath.length > 0 && (normalizedCwd === rootPath || normalizedCwd.startsWith(`${rootPath}/`))
	})
}

function basename(p: string): string {
	const cleaned = p.replace(/\\/g, "/").replace(/\/+$/, "")
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
}> = ({ taskCwd, workspaceRoots }) => {
	if (!isTaskCwdOutsideWorkspace(taskCwd, workspaceRoots ?? [])) {
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
					<span className="text-xs whitespace-nowrap overflow-hidden text-ellipsis min-w-0">{basename(cwd)}</span>
				</div>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default TaskWorkingDirectoryBadge
