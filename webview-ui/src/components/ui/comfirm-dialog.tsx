import { Dialog, DialogContent, DialogTitle } from "./dialog"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"

export interface ConfirmDialogProps {
	show: boolean
	icon: string
	title?: string
	message: string
	onResult: (confirm: boolean) => void
	onClose: () => void
}
export const ConfirmDialog = ({ onResult, onClose, icon, show, title, message }: ConfirmDialogProps) => {
	const onCloseConfirmDialog = useCallback(
		(confirm: boolean) => {
			onResult(confirm)
			onClose()
		},
		[onClose, onResult],
	)
	return (
		<Dialog
			open={show}
			onOpenChange={(open) => {
				!open && onCloseConfirmDialog(false)
			}}
			aria-labelledby="unsave-warning-dialog">
			<DialogContent className="p-4 max-w-sm">
				<DialogTitle>{title}</DialogTitle>
				<p className="text-lg mt-2" data-testid="error-message">
					<span
						style={{ fontSize: "2em" }}
						className={`codicon align-middle mr-1 ${icon || "codicon-warning"}`}
					/>
					<span>{message}</span>
				</p>
				<div className="flex justify-end gap-2 mt-4">
					<VSCodeButton
						appearance="primary"
						onClick={() => {
							onCloseConfirmDialog(true)
						}}>
						Yes
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						onClick={() => {
							onCloseConfirmDialog(false)
						}}>
						No
					</VSCodeButton>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default ConfirmDialog
