import { InspectWorktreeMutationRequest, type WorktreeMutationInspection } from "@shared/proto/bedrock_coder/worktree"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { WorktreeServiceClient } from "@/services/grpc-client"
import WorktreeMutationPreview from "./WorktreeMutationPreview"

interface DeleteWorktreeModalProps {
	open: boolean
	onClose: () => void
	onConfirm: (deleteBranch: boolean, allowDirty: boolean) => Promise<void>
	worktreePath: string
	branchName: string
}

const DeleteWorktreeModal = ({ open, onClose, onConfirm, worktreePath, branchName }: DeleteWorktreeModalProps) => {
	const [isDeleting, setIsDeleting] = useState(false)
	const [deleteBranch, setDeleteBranch] = useState(false)
	const [allowDirty, setAllowDirty] = useState(false)
	const [inspection, setInspection] = useState<WorktreeMutationInspection>()
	const [isInspecting, setIsInspecting] = useState(false)

	useEffect(() => {
		if (!open || !worktreePath) {
			setInspection(undefined)
			return
		}
		setIsInspecting(true)
		void WorktreeServiceClient.inspectWorktreeMutation(
			InspectWorktreeMutationRequest.create({
				operation: "delete",
				worktreePath,
				allowDirty,
			}),
		)
			.then(setInspection)
			.finally(() => setIsInspecting(false))
	}, [allowDirty, open, worktreePath])

	const handleDelete = useCallback(async () => {
		setIsDeleting(true)
		try {
			await onConfirm(deleteBranch, allowDirty)
			onClose()
		} finally {
			setIsDeleting(false)
			setDeleteBranch(false)
			setAllowDirty(false)
		}
	}, [onConfirm, onClose, deleteBranch, allowDirty])

	if (!open) {
		return null
	}

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
			onClick={(e) => {
				if (e.target === e.currentTarget && !isDeleting) {
					onClose()
				}
			}}>
			<div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-5 w-[400px] max-w-[90vw] relative">
				{/* Close button */}
				<button
					className="absolute top-3 right-3 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer disabled:opacity-50"
					disabled={isDeleting}
					onClick={onClose}
					type="button">
					<X className="w-4 h-4" />
				</button>

				{/* Title row with icon */}
				<div className="flex items-center gap-2 mb-3 pr-6">
					<AlertTriangle className="w-5 h-5 text-[var(--vscode-errorForeground)]" />
					<h4 className="m-0">Delete Worktree</h4>
				</div>

				{/* Content */}
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-3">
					This will delete the worktree directory at{" "}
					<span className="font-semibold text-[var(--vscode-foreground)] break-all">{worktreePath}</span>
				</p>

				<label className="flex items-center gap-2 cursor-pointer mb-3">
					<VSCodeCheckbox
						checked={deleteBranch}
						onChange={(e) => setDeleteBranch((e.target as HTMLInputElement).checked)}
					/>
					<span className="text-sm">
						Also delete branch <span className="font-semibold">{branchName}</span>
					</span>
				</label>

				{deleteBranch && (
					<p className="text-sm text-[var(--vscode-inputValidation-warningForeground)] mt-0 mb-3">
						Warning: Unpushed commits on this branch will be lost.
					</p>
				)}
				{inspection?.dirty && (
					<label className="mb-3 flex cursor-pointer items-start gap-2">
						<VSCodeCheckbox
							checked={allowDirty}
							onChange={(event) => setAllowDirty((event.target as HTMLInputElement).checked)}
						/>
						<span className="text-sm text-[var(--vscode-inputValidation-warningForeground)]">
							Separately approve removal of this dirty worktree and its untracked files.
						</span>
					</label>
				)}
				<WorktreeMutationPreview inspection={inspection} loading={isInspecting} />
				{deleteBranch && (
					<p className="mb-0 mt-2 break-all font-mono text-xs">Additional Git operation: git branch -d {branchName}</p>
				)}

				{/* Buttons */}
				<div className="flex justify-end gap-2">
					<VSCodeButton appearance="secondary" disabled={isDeleting} onClick={onClose}>
						Cancel
					</VSCodeButton>
					<Button disabled={isDeleting || isInspecting || !inspection?.allowed} onClick={handleDelete} variant="danger">
						{isDeleting ? (
							<>
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
								Deleting...
							</>
						) : (
							"Delete"
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}

export default memo(DeleteWorktreeModal)
