import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { memo, useCallback, useState } from "react"
import DangerButton from "@/components/common/DangerButton"

interface DeleteWorktreeModalProps {
	open: boolean
	onClose: () => void
	onConfirm: () => Promise<void>
	worktreePath: string
	branchName: string
}

const DeleteWorktreeModal = ({ open, onClose, onConfirm, worktreePath, branchName }: DeleteWorktreeModalProps) => {
	const [isDeleting, setIsDeleting] = useState(false)

	const handleDelete = useCallback(async () => {
		setIsDeleting(true)
		try {
			await onConfirm()
			onClose()
		} finally {
			setIsDeleting(false)
		}
	}, [onConfirm, onClose])

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
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-3">Are you sure? This will:</p>
				<ul className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-3 pl-5 list-disc">
					<li>
						Delete the branch <span className="font-semibold text-[var(--vscode-foreground)]">{branchName}</span>
					</li>
					<li className="break-all">
						Delete all project files at this location:{" "}
						<span className="font-semibold text-[var(--vscode-foreground)]">{worktreePath}</span>
					</li>
				</ul>

				{/* Buttons */}
				<div className="flex justify-end gap-2">
					<VSCodeButton appearance="secondary" disabled={isDeleting} onClick={onClose}>
						Cancel
					</VSCodeButton>
					<DangerButton disabled={isDeleting} onClick={handleDelete}>
						{isDeleting ? (
							<>
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
								Deleting...
							</>
						) : (
							"Delete"
						)}
					</DangerButton>
				</div>
			</div>
		</div>
	)
}

export default memo(DeleteWorktreeModal)
