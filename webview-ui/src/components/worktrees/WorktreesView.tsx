import { EmptyRequest } from "@shared/proto/cline/common"
import type { Worktree as WorktreeProto } from "@shared/proto/cline/worktree"
import { CreateWorktreeRequest, DeleteWorktreeRequest, SwitchWorktreeRequest } from "@shared/proto/cline/worktree"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { AlertCircle, BookOpen, ExternalLink, FolderOpen, GitBranch, Loader2, Plus, Trash2 } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { WorktreeServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"

type WorktreesViewProps = {
	onDone: () => void
}

const WorktreesView = ({ onDone }: WorktreesViewProps) => {
	const { environment } = useExtensionState()
	const [worktrees, setWorktrees] = useState<WorktreeProto[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isGitRepo, setIsGitRepo] = useState(true)
	const [showCreateForm, setShowCreateForm] = useState(false)
	const [newWorktreePath, setNewWorktreePath] = useState("")
	const [newBranchName, setNewBranchName] = useState("")
	const [isCreating, setIsCreating] = useState(false)
	const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null)

	// Check if a worktree is the main/primary worktree (first one, typically the original clone)
	const isMainWorktree = useCallback(
		(worktree: WorktreeProto) => {
			// The main worktree is typically the first one listed and is where .git directory lives
			// It's also usually the one that's marked as "bare" or is the original clone location
			if (worktrees.length === 0) return false
			return worktree.path === worktrees[0]?.path || worktree.isBare
		},
		[worktrees],
	)

	// Load worktrees
	const loadWorktrees = useCallback(async () => {
		setIsLoading(true)
		setError(null)
		try {
			const response = await WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			setWorktrees(response.worktrees)
			setIsGitRepo(response.isGitRepo)
			if (response.error) {
				setError(response.error)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load worktrees")
		} finally {
			setIsLoading(false)
		}
	}, [])

	useEffect(() => {
		loadWorktrees()
	}, [loadWorktrees])

	const handleCreateWorktree = useCallback(async () => {
		if (!newWorktreePath || !newBranchName) return

		setIsCreating(true)
		try {
			const result = await WorktreeServiceClient.createWorktree(
				CreateWorktreeRequest.create({
					path: newWorktreePath,
					branch: newBranchName,
					createNewBranch: true,
				}),
			)

			if (!result.success) {
				setError(result.message)
			} else {
				await loadWorktrees()
				setShowCreateForm(false)
				setNewWorktreePath("")
				setNewBranchName("")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create worktree")
		} finally {
			setIsCreating(false)
		}
	}, [newWorktreePath, newBranchName, loadWorktrees])

	const handleDeleteWorktree = useCallback(
		async (path: string) => {
			try {
				const result = await WorktreeServiceClient.deleteWorktree(
					DeleteWorktreeRequest.create({
						path,
						force: false,
					}),
				)

				if (!result.success) {
					setError(result.message)
				} else {
					await loadWorktrees()
				}
				setDeleteConfirmPath(null)
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to delete worktree")
			}
		},
		[loadWorktrees],
	)

	const handleSwitchWorktree = useCallback(async (path: string, newWindow: boolean) => {
		try {
			await WorktreeServiceClient.switchWorktree(
				SwitchWorktreeRequest.create({
					path,
					newWindow,
				}),
			)
		} catch (err) {
			console.error("Failed to switch worktree:", err)
		}
	}, [])

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden">
			{/* Header */}
			<div className="px-5 py-4 border-b border-[var(--vscode-panel-border)]">
				<div className="flex justify-between items-center mb-3">
					<h3 className="m-0" style={{ color: getEnvironmentColor(environment) }}>
						Git Worktrees
					</h3>
					<div className="flex gap-2">
						<VSCodeButton
							appearance="secondary"
							disabled={!isGitRepo || isLoading}
							onClick={() => setShowCreateForm(true)}>
							<Plus className="w-4 h-4 mr-1" />
							New Worktree
						</VSCodeButton>
						<VSCodeButton onClick={onDone}>Done</VSCodeButton>
					</div>
				</div>
				<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0 mb-2">
					Worktrees let you work on multiple branches at the same time, each in its own folder. Instead of switching
					branches (which changes all your files), you can have separate folders for each branch and switch between them
					instantly.
				</p>
				<a
					className="inline-flex items-center gap-1 text-sm text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
					href="https://docs.cline.bot/worktrees"
					rel="noopener noreferrer"
					target="_blank">
					<BookOpen className="w-3.5 h-3.5" />
					Learn more about worktrees
				</a>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-5">
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="w-6 h-6 animate-spin text-[var(--vscode-descriptionForeground)]" />
						<span className="ml-2 text-[var(--vscode-descriptionForeground)]">Loading worktrees...</span>
					</div>
				) : !isGitRepo ? (
					<div className="flex flex-col items-center justify-center h-32 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-descriptionForeground)] mb-2" />
						<p className="text-[var(--vscode-descriptionForeground)]">
							Not a git repository. Worktrees require a git repository.
						</p>
					</div>
				) : error ? (
					<div className="flex flex-col items-center justify-center h-32 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-errorForeground)] mb-2" />
						<p className="text-[var(--vscode-errorForeground)]">{error}</p>
						<VSCodeButton appearance="secondary" className="mt-3" onClick={loadWorktrees}>
							Retry
						</VSCodeButton>
					</div>
				) : worktrees.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-32 text-center">
						<GitBranch className="w-8 h-8 text-[var(--vscode-descriptionForeground)] mb-2" />
						<p className="text-[var(--vscode-descriptionForeground)]">No worktrees found.</p>
						<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-1">
							Create a new worktree to work on multiple branches simultaneously.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{worktrees.map((worktree) => (
							<div
								className={`p-4 rounded border ${
									worktree.isCurrent
										? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)]"
										: "border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)]"
								}`}
								key={worktree.path}>
								<div className="flex items-start justify-between">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<GitBranch className="w-4 h-4 flex-shrink-0 text-[var(--vscode-button-background)]" />
											<span className="font-medium truncate">
												{worktree.branch || (worktree.isDetached ? "HEAD (detached)" : "unknown")}
											</span>
											{isMainWorktree(worktree) && (
												<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
													Main
												</span>
											)}
											{worktree.isCurrent && (
												<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]">
													Current
												</span>
											)}
											{worktree.isLocked && (
												<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-inputValidation-warningBackground)] text-[var(--vscode-inputValidation-warningForeground)]">
													Locked
												</span>
											)}
										</div>
										<div className="flex items-center gap-1 text-sm text-[var(--vscode-descriptionForeground)]">
											<FolderOpen className="w-3 h-3" />
											<span className="truncate">{worktree.path}</span>
										</div>
										{worktree.commitHash && (
											<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1 font-mono">
												{worktree.commitHash.substring(0, 8)}
											</div>
										)}
									</div>
									<div className="flex items-center gap-1 ml-2">
										{!worktree.isCurrent && (
											<>
												<VSCodeButton
													appearance="icon"
													onClick={() => handleSwitchWorktree(worktree.path, false)}
													title="Open in current window">
													<FolderOpen className="w-4 h-4" />
												</VSCodeButton>
												<VSCodeButton
													appearance="icon"
													onClick={() => handleSwitchWorktree(worktree.path, true)}
													title="Open in new window">
													<ExternalLink className="w-4 h-4" />
												</VSCodeButton>
											</>
										)}
										{!worktree.isCurrent && !isMainWorktree(worktree) && (
											<>
												{deleteConfirmPath === worktree.path ? (
													<div className="flex items-center gap-1">
														<VSCodeButton
															appearance="secondary"
															className="text-xs"
															onClick={() => setDeleteConfirmPath(null)}>
															Cancel
														</VSCodeButton>
														<VSCodeButton
															className="text-xs bg-[var(--vscode-inputValidation-errorBackground)]"
															onClick={() => handleDeleteWorktree(worktree.path)}>
															Delete
														</VSCodeButton>
													</div>
												) : (
													<VSCodeButton
														appearance="icon"
														onClick={() => setDeleteConfirmPath(worktree.path)}
														title="Delete worktree">
														<Trash2 className="w-4 h-4 text-[var(--vscode-errorForeground)]" />
													</VSCodeButton>
												)}
											</>
										)}
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Create Worktree Modal */}
			{showCreateForm && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
					<div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-5 w-[450px] max-w-[90vw]">
						<h4 className="mt-0 mb-2">Create New Worktree</h4>
						<p className="text-sm text-[var(--vscode-descriptionForeground)] mt-0 mb-4">
							This will create a new folder with a copy of your code on a new branch. You can work on both branches
							simultaneously without switching.
						</p>
						<div className="flex flex-col gap-4">
							<div>
								<label className="block text-sm font-medium mb-1">Branch Name *</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e) => setNewBranchName((e.target as HTMLInputElement).value)}
									placeholder="feature/my-feature"
									value={newBranchName}
								/>
								<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
									A new branch will be created with this name. This branch will be dedicated to this worktree.
								</p>
							</div>
							<div>
								<label className="block text-sm font-medium mb-1">Folder Path *</label>
								<VSCodeTextField
									className="w-full"
									onInput={(e) => setNewWorktreePath((e.target as HTMLInputElement).value)}
									placeholder="../my-feature-worktree"
									value={newWorktreePath}
								/>
								<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
									Where to create the new worktree folder. Use a path outside your current project folder (e.g.,
									"../my-feature" creates a sibling folder).
								</p>
							</div>
							<div className="flex justify-end gap-2 mt-2">
								<VSCodeButton
									appearance="secondary"
									disabled={isCreating}
									onClick={() => {
										setShowCreateForm(false)
										setNewWorktreePath("")
										setNewBranchName("")
									}}>
									Cancel
								</VSCodeButton>
								<VSCodeButton
									disabled={!newWorktreePath || !newBranchName || isCreating}
									onClick={handleCreateWorktree}>
									{isCreating ? (
										<>
											<Loader2 className="w-4 h-4 mr-1 animate-spin" />
											Creating...
										</>
									) : (
										"Create Worktree"
									)}
								</VSCodeButton>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default memo(WorktreesView)
