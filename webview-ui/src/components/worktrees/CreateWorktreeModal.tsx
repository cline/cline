import { EmptyRequest } from "@shared/proto/cline/common"
import { CreateWorktreeRequest, SwitchWorktreeRequest } from "@shared/proto/cline/worktree"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { AlertCircle, AlertTriangle, Loader2, X } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { WorktreeServiceClient } from "@/services/grpc-client"

interface CreateWorktreeModalProps {
	open: boolean
	onClose: () => void
	/** When true, opens the worktree in a new window after creation */
	openAfterCreate?: boolean
	/** Called after successful creation (and opening if openAfterCreate is true) */
	onSuccess?: () => void
}

const CreateWorktreeModal = ({ open, onClose, openAfterCreate = false, onSuccess }: CreateWorktreeModalProps) => {
	const [newWorktreePath, setNewWorktreePath] = useState("")
	const [newBranchName, setNewBranchName] = useState("")
	const [isCreating, setIsCreating] = useState(false)
	const [createError, setCreateError] = useState<string | null>(null)
	const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)
	const [hasWorktreeInclude, setHasWorktreeInclude] = useState<boolean | null>(null)

	// Load defaults and check .worktreeinclude status when modal opens
	const loadDefaults = useCallback(async () => {
		setIsLoadingDefaults(true)
		try {
			const [defaults, includeStatus] = await Promise.all([
				WorktreeServiceClient.getWorktreeDefaults(EmptyRequest.create({})),
				WorktreeServiceClient.getWorktreeIncludeStatus(EmptyRequest.create({})),
			])
			setNewBranchName(defaults.suggestedBranch)
			setNewWorktreePath(defaults.suggestedPath)
			setHasWorktreeInclude(includeStatus.exists)
		} catch (err) {
			console.error("Failed to load worktree defaults:", err)
		} finally {
			setIsLoadingDefaults(false)
		}
	}, [])

	useEffect(() => {
		if (open) {
			loadDefaults()
		}
	}, [open, loadDefaults])

	// Reset form state when modal closes
	useEffect(() => {
		if (!open) {
			setNewWorktreePath("")
			setNewBranchName("")
			setCreateError(null)
			setHasWorktreeInclude(null)
		}
	}, [open])

	const handleCreateWorktree = useCallback(async () => {
		if (!newWorktreePath || !newBranchName) {
			return
		}

		setIsCreating(true)
		setCreateError(null)
		try {
			const result = await WorktreeServiceClient.createWorktree(
				CreateWorktreeRequest.create({
					path: newWorktreePath,
					branch: newBranchName,
					createNewBranch: true,
				}),
			)

			if (!result.success) {
				setCreateError(result.message)
			} else {
				// If openAfterCreate is true, open the worktree in a new window
				if (openAfterCreate && result.worktree?.path) {
					await WorktreeServiceClient.switchWorktree(
						SwitchWorktreeRequest.create({
							path: result.worktree.path,
							newWindow: true,
						}),
					)
				}
				onSuccess?.()
				onClose()
			}
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "Failed to create worktree")
		} finally {
			setIsCreating(false)
		}
	}, [newWorktreePath, newBranchName, openAfterCreate, onSuccess, onClose])

	if (!open) {
		return null
	}

	const title = openAfterCreate ? "New Worktree" : "Create New Worktree"
	const buttonText = openAfterCreate ? "Create & Open" : "Create Worktree"
	const creatingText = openAfterCreate ? "Creating & Opening..." : "Creating..."
	const description = openAfterCreate
		? "This will create a copy of your project on a new branch and open in a separate window."
		: "This will create a copy of your project on a new branch."

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					onClose()
				}
			}}>
			<div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-5 w-[450px] max-w-[90vw] relative">
				{/* Close button */}
				<button
					className="absolute top-3 right-3 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer"
					onClick={onClose}
					type="button">
					<X className="w-4 h-4" />
				</button>
				<h4 className="mt-0 mb-2 pr-6">{title}</h4>
				<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-4">{description}</p>
				{hasWorktreeInclude === false && (
					<div
						className="flex items-start gap-2 p-2 rounded mb-3"
						style={{ backgroundColor: "var(--vscode-inputValidation-warningBackground)" }}>
						<AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--vscode-editorWarning-foreground)]" />
						<p className="text-xs text-[var(--vscode-foreground)] m-0">
							No .worktreeinclude detected.{" "}
							<a
								className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
								href="https://docs.cline.bot/features/worktrees#worktreeinclude"
								rel="noopener noreferrer"
								style={{ fontSize: "inherit" }}
								target="_blank">
								Learn more
							</a>
						</p>
					</div>
				)}
				<div className="flex flex-col">
					<div>
						<label className="block text-sm font-medium mb-1">Branch Name *</label>
						<VSCodeTextField
							className="w-full"
							onInput={(e) => setNewBranchName((e.target as HTMLInputElement).value)}
							placeholder="feature/my-feature"
							value={newBranchName}>
							{newBranchName && (
								<div
									aria-label="Clear"
									className="input-icon-button codicon codicon-close"
									onClick={() => setNewBranchName("")}
									slot="end"
									style={{
										display: "flex",
										justifyContent: "center",
										alignItems: "center",
										height: "100%",
									}}
								/>
							)}
						</VSCodeTextField>
						<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
							Your new copy will be checked out to this branch.
						</p>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">Folder Path *</label>
						<VSCodeTextField
							className="w-full"
							onInput={(e) => setNewWorktreePath((e.target as HTMLInputElement).value)}
							placeholder="../my-feature-worktree"
							value={newWorktreePath}>
							{newWorktreePath && (
								<div
									aria-label="Clear"
									className="input-icon-button codicon codicon-close"
									onClick={() => setNewWorktreePath("")}
									slot="end"
									style={{
										display: "flex",
										justifyContent: "center",
										alignItems: "center",
										height: "100%",
									}}
								/>
							)}
						</VSCodeTextField>
						<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
							Where the project will be copied for the worktree.
						</p>
					</div>
					{createError && (
						<div className="flex items-start gap-2 p-3 rounded bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)]">
							<AlertCircle className="w-4 h-4 flex-shrink-0 text-[var(--vscode-errorForeground)] mt-0.5" />
							<p className="text-sm text-[var(--vscode-errorForeground)] m-0">{createError}</p>
						</div>
					)}
					<div className="flex justify-end gap-2">
						<VSCodeButton
							disabled={!newWorktreePath || !newBranchName || isCreating || isLoadingDefaults}
							onClick={handleCreateWorktree}>
							{isLoadingDefaults ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									Loading...
								</>
							) : isCreating ? (
								<>
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									{creatingText}
								</>
							) : (
								buttonText
							)}
						</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default memo(CreateWorktreeModal)
