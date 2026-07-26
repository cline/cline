import type { WorktreeMutationInspection } from "@shared/proto/cline/worktree"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { memo } from "react"

type Props = {
	inspection?: WorktreeMutationInspection
	loading?: boolean
}

const WorktreeMutationPreview = ({ inspection, loading }: Props) => {
	if (loading) {
		return <p className="m-0 text-xs text-[var(--vscode-descriptionForeground)]">Inspecting repository state…</p>
	}
	if (!inspection) return null

	return (
		<div className="rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-textCodeBlock-background)] p-3 text-xs">
			<div className="mb-2 flex items-center gap-1.5 font-medium">
				{inspection.allowed ? (
					<CheckCircle2 className="h-4 w-4 text-[var(--vscode-testing-iconPassed)]" />
				) : (
					<AlertTriangle className="h-4 w-4 text-[var(--vscode-editorWarning-foreground)]" />
				)}
				Validated operation
			</div>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
				<dt>Repository</dt>
				<dd className="m-0 break-all">{inspection.repositoryRoot || "Unavailable"}</dd>
				<dt>Worktree</dt>
				<dd className="m-0 break-all">{inspection.worktreePath}</dd>
				<dt>Branch / base</dt>
				<dd className="m-0 break-all">
					{inspection.branch || "detached"} / {inspection.baseBranch || inspection.targetBranch || "current HEAD"}
				</dd>
				<dt>Git operation</dt>
				<dd className="m-0 break-all font-mono">{inspection.gitOperation.join(" ") || "Unavailable"}</dd>
				<dt>Working tree</dt>
				<dd className="m-0">
					{inspection.dirty
						? `Dirty${inspection.untrackedFiles.length ? `; ${inspection.untrackedFiles.length} untracked` : ""}`
						: "Clean"}
				</dd>
				<dt>Task / agent</dt>
				<dd className="m-0">
					{inspection.affectedTaskId || "None"} / {inspection.affectedAgentId || "None"}
				</dd>
			</dl>
			{inspection.reason && <p className="mb-0 mt-2 text-[var(--vscode-errorForeground)]">{inspection.reason}</p>}
		</div>
	)
}

export default memo(WorktreeMutationPreview)
