import { EmptyRequest } from "@shared/proto/cline/common"
import type { Worktree as WorktreeProto } from "@shared/proto/cline/worktree"
import {
	CreateWorktreeIncludeRequest,
	CreateWorktreeRequest,
	DeleteWorktreeRequest,
	SwitchWorktreeRequest,
} from "@shared/proto/cline/worktree"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { AlertCircle, Check, ExternalLink, FolderOpen, GitBranch, Loader2, Plus, Trash2, X } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, WorktreeServiceClient } from "@/services/grpc-client"
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
	const [createError, setCreateError] = useState<string | null>(null)
	const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null)
	const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)

	// .worktreeinclude status
	const [hasWorktreeInclude, setHasWorktreeInclude] = useState(false)
	const [hasGitignore, setHasGitignore] = useState(false)
	const [gitignoreContent, setGitignoreContent] = useState("")
	const [isCreatingWorktreeInclude, setIsCreatingWorktreeInclude] = useState(false)

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

	// Load .worktreeinclude status
	const loadWorktreeIncludeStatus = useCallback(async () => {
		try {
			const status = await WorktreeServiceClient.getWorktreeIncludeStatus(EmptyRequest.create({}))
			setHasWorktreeInclude(status.exists)
			setHasGitignore(status.hasGitignore)
			setGitignoreContent(status.gitignoreContent)
		} catch (err) {
			console.error("Failed to load worktree include status:", err)
		}
	}, [])

	// Create .worktreeinclude file and open it in editor
	const handleCreateWorktreeInclude = useCallback(async () => {
		setIsCreatingWorktreeInclude(true)
		try {
			const result = await WorktreeServiceClient.createWorktreeInclude(
				CreateWorktreeIncludeRequest.create({
					content: gitignoreContent,
				}),
			)
			if (result.success) {
				setHasWorktreeInclude(true)
				// Open the file in the editor
				await FileServiceClient.openFileRelativePath({ value: ".worktreeinclude" })
			} else {
				setError(result.message)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create .worktreeinclude")
		} finally {
			setIsCreatingWorktreeInclude(false)
		}
	}, [gitignoreContent])

	useEffect(() => {
		loadWorktrees()
		loadWorktreeIncludeStatus()
	}, [loadWorktrees, loadWorktreeIncludeStatus])

	// Fetch and apply suggested defaults for branch name and path
	const loadDefaults = useCallback(async () => {
		setIsLoadingDefaults(true)
		try {
			const defaults = await WorktreeServiceClient.getWorktreeDefaults(EmptyRequest.create({}))
			setNewBranchName(defaults.suggestedBranch)
			setNewWorktreePath(defaults.suggestedPath)
		} catch (err) {
			console.error("Failed to load worktree defaults:", err)
		} finally {
			setIsLoadingDefaults(false)
		}
	}, [])

	// Close modal and reset form state
	const closeCreateForm = useCallback(() => {
		setShowCreateForm(false)
		setNewWorktreePath("")
		setNewBranchName("")
		setCreateError(null)
	}, [])

	const handleCreateWorktree = useCallback(async () => {
		if (!newWorktreePath || !newBranchName) return

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
				await loadWorktrees()
				setShowCreateForm(false)
				setNewWorktreePath("")
				setNewBranchName("")
				setCreateError(null)
			}
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "Failed to create worktree")
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
			{/* Sticky Header with title and Done button */}
			<div className="flex-none flex justify-between items-center px-5 py-3 border-b border-[var(--vscode-panel-border)]">
				<h3 className="m-0" style={{ color: getEnvironmentColor(environment) }}>
					Worktrees
				</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			{/* Scrollable Content */}
			<div className="flex-1 overflow-y-auto p-5">
				{/* Description */}
				<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0 mb-4">
					Git worktrees let you work on multiple branches at the same time, each in its own folder. Open worktrees in
					their own VS Code windows so Cline can work on multiple tasks in parallel.{" "}
					<a
						className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
						href="https://docs.cline.bot/worktrees"
						rel="noopener noreferrer"
						style={{ fontSize: "inherit" }}
						target="_blank">
						Learn more
					</a>
				</p>

				{/* .worktreeinclude status */}
				{isGitRepo && (
					<div
						className="p-3 rounded-md"
						style={{
							border: "1px solid var(--vscode-widget-border)",
							backgroundColor: "var(--vscode-list-hoverBackground)",
						}}>
						{hasWorktreeInclude ? (
							<p className="text-sm text-[var(--vscode-testing-iconPassed)] m-0">
								<Check className="w-4 h-4 inline-block align-text-bottom mr-1" />
								.worktreeinclude detected.{" "}
								<a
									className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
									href="https://docs.cline.bot/worktreeinclude"
									rel="noopener noreferrer"
									style={{ fontSize: "inherit" }}
									target="_blank">
									Learn more
								</a>
							</p>
						) : (
							<div className="flex flex-col gap-2">
								<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0">
									<strong>Tip:</strong> Create a{" "}
									<code className="bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">
										.worktreeinclude
									</code>{" "}
									file to automatically copy files like{" "}
									<code className="bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">
										node_modules/
									</code>{" "}
									to new worktrees, so you don't have to reinstall dependencies.{" "}
									<a
										className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
										href="https://docs.cline.bot/worktreeinclude"
										rel="noopener noreferrer"
										style={{ fontSize: "inherit" }}
										target="_blank">
										Learn more
									</a>
								</p>
								{hasGitignore && (
									<VSCodeButton
										appearance="secondary"
										disabled={isCreatingWorktreeInclude}
										onClick={handleCreateWorktreeInclude}>
										{isCreatingWorktreeInclude ? (
											<>
												<Loader2 className="w-3 h-3 mr-1 animate-spin" />
												Creating...
											</>
										) : (
											"Create from .gitignore"
										)}
									</VSCodeButton>
								)}
							</div>
						)}
					</div>
				)}

				{/* Loading/Error States */}
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="w-6 h-6 animate-spin text-[var(--vscode-descriptionForeground)]" />
						<span className="ml-2 text-[var(--vscode-descriptionForeground)]">Loading...</span>
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
					</div>
				) : (
					<>
						{/* Worktrees List - current worktree first, then others */}
						<div className="mt-4 flex flex-col gap-2">
							{worktrees.map((worktree) => (
								<div
									className={`p-4 rounded border ${
										worktree.isCurrent
											? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)]"
											: "border-[var(--vscode-panel-border)]"
									}`}
									key={worktree.path}>
									{/* Branch name, badges, and action buttons - wraps on small screens */}
									<div className="flex flex-wrap items-center justify-between gap-2 mb-1">
										{/* Left side: branch name and badges */}
										<div className="flex flex-wrap items-center gap-2">
											<div className="flex items-center gap-2">
												<GitBranch className="w-4 h-4 flex-shrink-0 text-[var(--vscode-button-background)]" />
												<span className="font-medium">
													{worktree.branch || (worktree.isDetached ? "HEAD (detached)" : "unknown")}
												</span>
											</div>
											{isMainWorktree(worktree) && (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] cursor-help">
															Main
														</span>
													</TooltipTrigger>
													<TooltipContent side="bottom">
														The primary worktree where your .git directory lives. This cannot be
														deleted.
													</TooltipContent>
												</Tooltip>
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
										{/* Right side: action buttons */}
										<div className="flex items-center gap-1">
											{!worktree.isCurrent && (
												<>
													<Tooltip>
														<TooltipTrigger asChild>
															<VSCodeButton
																appearance="icon"
																onClick={() => handleSwitchWorktree(worktree.path, false)}>
																<FolderOpen className="w-4 h-4" />
															</VSCodeButton>
														</TooltipTrigger>
														<TooltipContent side="bottom">Open in current window</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<VSCodeButton
																appearance="icon"
																onClick={() => handleSwitchWorktree(worktree.path, true)}>
																<ExternalLink className="w-4 h-4" />
															</VSCodeButton>
														</TooltipTrigger>
														<TooltipContent side="bottom">Open in new window</TooltipContent>
													</Tooltip>
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
														<Tooltip>
															<TooltipTrigger asChild>
																<VSCodeButton
																	appearance="icon"
																	onClick={() => setDeleteConfirmPath(worktree.path)}>
																	<Trash2 className="w-4 h-4 text-[var(--vscode-errorForeground)]" />
																</VSCodeButton>
															</TooltipTrigger>
															<TooltipContent side="bottom">Remove this worktree</TooltipContent>
														</Tooltip>
													)}
												</>
											)}
										</div>
									</div>
									{/* Path */}
									<div className="flex items-center gap-1 text-sm text-[var(--vscode-descriptionForeground)]">
										<FolderOpen className="w-3 h-3 flex-shrink-0" />
										<span className="truncate">{worktree.path}</span>
									</div>
									{/* Commit hash */}
									{worktree.commitHash && (
										<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1 font-mono">
											{worktree.commitHash.substring(0, 8)}
										</div>
									)}
								</div>
							))}
						</div>
					</>
				)}
			</div>

			{/* Fixed Bottom - New Worktree Button */}
			{isGitRepo && (
				<div
					className="flex-none px-5 py-3"
					style={{
						borderTop: "1px solid var(--vscode-panel-border)",
					}}>
					<VSCodeButton disabled={isLoading} onClick={() => setShowCreateForm(true)} style={{ width: "100%" }}>
						<Plus className="w-4 h-4 mr-1" />
						New Worktree
					</VSCodeButton>
				</div>
			)}

			{/* Create Worktree Modal */}
			{showCreateForm && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
					onClick={(e) => {
						// Close when clicking the backdrop (not the modal content)
						if (e.target === e.currentTarget) {
							closeCreateForm()
						}
					}}>
					<div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-5 w-[450px] max-w-[90vw] relative">
						{/* Close button */}
						<button
							className="absolute top-3 right-3 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] transition-colors"
							onClick={closeCreateForm}
							type="button">
							<X className="w-4 h-4" />
						</button>
						<h4 className="mt-0 mb-2 pr-6">Create New Worktree</h4>
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
							{createError && (
								<div className="flex items-start gap-2 p-3 rounded bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)]">
									<AlertCircle className="w-4 h-4 flex-shrink-0 text-[var(--vscode-errorForeground)] mt-0.5" />
									<p className="text-sm text-[var(--vscode-errorForeground)] m-0">{createError}</p>
								</div>
							)}
							<div className="flex justify-end gap-2 mt-2">
								<VSCodeButton
									appearance="secondary"
									disabled={isLoadingDefaults || isCreating}
									onClick={loadDefaults}>
									{isLoadingDefaults ? (
										<>
											<Loader2 className="w-4 h-4 mr-1 animate-spin" />
											Generating...
										</>
									) : (
										"Auto-fill"
									)}
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
