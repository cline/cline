import { AssociateTaskWithWorkspaceRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle } from "lucide-react"
import { memo, useCallback } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../settings/OpenRouterModelPicker"

interface CrossWorkspaceWarningModalProps {
	open: boolean
	taskId: string
	taskName: string
	originalWorkspaceName: string
	currentWorkspacePath: string
	onCancel: () => void
	onContinue: () => void
}

const CrossWorkspaceWarningModal = ({
	open,
	taskId,
	taskName,
	originalWorkspaceName,
	currentWorkspacePath,
	onCancel,
	onContinue,
}: CrossWorkspaceWarningModalProps) => {
	const handleAssociateAndContinue = useCallback(async () => {
		try {
			// Associate task with current workspace
			await TaskServiceClient.associateTaskWithWorkspace(
				AssociateTaskWithWorkspaceRequest.create({
					taskId,
					workspacePath: currentWorkspacePath,
				}),
			)

			// Continue with opening the task
			onContinue()
		} catch (error) {
			console.error("Error associating task with workspace:", error)
			// Still continue even if association fails - user can try again
			onContinue()
		}
	}, [taskId, currentWorkspacePath, onContinue])

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onCancel()
		}
	}

	if (!open) {
		return null
	}

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-center justify-center"
			onClick={handleBackdropClick}
			style={{ zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX + 50 }}>
			<div
				className="fixed top-[50%] left-[50%] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%]"
				onClick={(e) => e.stopPropagation()}>
				<div className="bg-[var(--vscode-editor-background)] rounded-sm gap-3 border border-[var(--vscode-panel-border)] p-6 shadow-lg sm:max-w-lg">
					{/* Header */}
					<div className="flex flex-col gap-1 text-left">
						<h2 className="text-base font-medium text-[var(--vscode-editor-foreground)] flex items-center gap-2 text-left">
							<AlertTriangle className="w-5 h-5 text-[var(--vscode-notificationsWarningIcon-foreground)]" />
							Cross-Workspace Task
						</h2>
						<div className="text-[var(--vscode-descriptionForeground)] text-sm text-left mt-2">
							<p className="mb-3">
								This conversation was started in workspace <strong>"{originalWorkspaceName}"</strong>.
							</p>
							{taskName && (
								<div className="mb-3 p-2 bg-[var(--vscode-textBlockQuote-background)] border-l-2 border-[var(--vscode-textBlockQuote-border)] rounded">
									<p className="text-xs opacity-60 mb-1">Task:</p>
									<p className="text-sm line-clamp-2">{taskName}</p>
								</div>
							)}
							<p>Do you want to add it to the current workspace and continue?</p>
						</div>
					</div>

					{/* Footer */}
					<div className="flex flex-row justify-end gap-3 mt-6">
						<VSCodeButton appearance="secondary" onClick={onCancel}>
							Cancel
						</VSCodeButton>
						<VSCodeButton appearance="primary" onClick={handleAssociateAndContinue}>
							Add to Current Workspace & Continue
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default memo(CrossWorkspaceWarningModal)
