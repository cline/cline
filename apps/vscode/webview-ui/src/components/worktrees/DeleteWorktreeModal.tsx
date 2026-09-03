import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

interface DeleteWorktreeModalProps {
	open: boolean
	onClose: () => void
	onConfirm: (deleteBranch: boolean) => Promise<void>
	worktreePath: string
	branchName: string
}

const DeleteWorktreeModal = ({ open, onClose, onConfirm, worktreePath, branchName }: DeleteWorktreeModalProps) => {
	const { t } = useTranslation()
	const [isDeleting, setIsDeleting] = useState(false)
	const [deleteBranch, setDeleteBranch] = useState(false)

	const handleDelete = useCallback(async () => {
		setIsDeleting(true)
		try {
			await onConfirm(deleteBranch)
			onClose()
		} finally {
			setIsDeleting(false)
			setDeleteBranch(false)
		}
	}, [onConfirm, onClose, deleteBranch])

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
					<h4 className="m-0">{t("worktrees:deleteTitle")}</h4>
				</div>

				{/* Content */}
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-3">
					<Trans
						components={{
							pathEl: <span className="font-semibold text-[var(--vscode-foreground)] break-all" />,
						}}
						i18nKey="worktrees:deleteConfirm"
						values={{ path: worktreePath }}
					/>
				</p>

				<label className="flex items-center gap-2 cursor-pointer mb-3">
					<VSCodeCheckbox
						checked={deleteBranch}
						onChange={(e) => setDeleteBranch((e.target as HTMLInputElement).checked)}
					/>
					<span className="text-sm">
						<Trans
							components={{ branchEl: <span className="font-semibold" /> }}
							i18nKey="worktrees:deleteAlsoBranch"
							values={{ branch: branchName }}
						/>
					</span>
				</label>

				{deleteBranch && (
					<p className="text-sm text-[var(--vscode-inputValidation-warningForeground)] mt-0 mb-3">
						{t("worktrees:warnUnpushed")}
					</p>
				)}

				{/* Buttons */}
				<div className="flex justify-end gap-2">
					<VSCodeButton appearance="secondary" disabled={isDeleting} onClick={onClose}>
						{t("worktrees:cancel")}
					</VSCodeButton>
					<Button disabled={isDeleting} onClick={handleDelete} variant="danger">
						{isDeleting ? (
							<>
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
								{t("worktrees:deleting")}
							</>
						) : (
							t("worktrees:delete")
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}

export default memo(DeleteWorktreeModal)
