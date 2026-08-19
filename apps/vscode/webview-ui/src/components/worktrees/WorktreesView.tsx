import { EmptyRequest } from "@shared/proto/cline/common"
import { NewTaskRequest } from "@shared/proto/cline/task"
import type { MergeWorktreeResult, Worktree as WorktreeProto } from "@shared/proto/cline/worktree"
import {
	CreateWorktreeIncludeRequest,
	DeleteWorktreeRequest,
	MergeWorktreeRequest,
	SwitchWorktreeRequest,
} from "@shared/proto/cline/worktree"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { AlertCircle, Check, ExternalLink, FolderOpen, GitBranch, GitMerge, Loader2, Plus, Trash2, X } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, TaskServiceClient, WorktreeServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CreateWorktreeModal from "./CreateWorktreeModal"
import DeleteWorktreeModal from "./DeleteWorktreeModal"

type WorktreesViewProps = {
	onDone: () => void
}

const WorktreesView = ({ onDone }: WorktreesViewProps) => {
	const { environment } = useExtensionState()
	const [worktrees, setWorktrees] = useState<WorktreeProto[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isGitRepo, setIsGitRepo] = useState(true)
	const [isMultiRoot, setIsMultiRoot] = useState(false)
	const [isSubfolder, setIsSubfolder] = useState(false)
	const [gitRootPath, setGitRootPath] = useState("")
	const [showCreateForm, setShowCreateForm] = useState(false)
	const [deleteWorktree, setDeleteWorktree] = useState<WorktreeProto | null>(null)

	// Merge worktree state
	const [mergeWorktree, setMergeWorktree] = useState<WorktreeProto | null>(null)
	const [isMerging, setIsMerging] = useState(false)
	const [mergeError, setMergeError] = useState<string | null>(null)
	const [mergeResult, setMergeResult] = useState<MergeWorktreeResult | null>(null)
	const [deleteAfterMerge, setDeleteAfterMerge] = useState(true)

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

	// Load worktrees - only updates state if data changed to prevent flickering
	const loadWorktrees = useCallback(async () => {
		try {
			const response = await WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			// Only update state if data actually changed (prevents flickering)
			setWorktrees((prev) => {
				const newData = JSON.stringify(response.worktrees)
				const oldData = JSON.stringify(prev)
				return newData === oldData ? prev : response.worktrees
			})
			setIsGitRepo((prev) => (prev === response.isGitRepo ? prev : response.isGitRepo))
			setIsMultiRoot((prev) => (prev === response.isMultiRoot ? prev : response.isMultiRoot))
			setIsSubfolder((prev) => (prev === response.isSubfolder ? prev : response.isSubfolder))
			setGitRootPath((prev) => (prev === response.gitRootPath ? prev : response.gitRootPath))
			setError((prev) => (response.error ? response.error : prev === null ? null : prev))
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

	// Initial load
	useEffect(() => {
		loadWorktrees()
		loadWorktreeIncludeStatus()
	}, [loadWorktrees, loadWorktreeIncludeStatus])

	// Poll for updates every 3 seconds while the view is open
	useEffect(() => {
		const interval = setInterval(loadWorktrees, 3000)
		return () => clearInterval(interval)
	}, [loadWorktrees])

	const handleDeleteWorktree = useCallback(
		async (path: string, deleteBranch: boolean, branchName: string) => {
			try {
				const result = await WorktreeServiceClient.deleteWorktree(
					DeleteWorktreeRequest.create({
						path,
						force: false,
						deleteBranch,
						branchName,
					}),
				)

				if (!result.success) {
					setError(result.message)
				} else {
					await loadWorktrees()
				}
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

	// Get the main branch name (first worktree's branch, usually main/master)
	const getMainBranch = useCallback(() => {
		if (worktrees.length === 0) return "main"
		return worktrees[0]?.branch || "main"
	}, [worktrees])

	// Open merge modal for a worktree
	const openMergeModal = useCallback((worktree: WorktreeProto) => {
		setMergeWorktree(worktree)
		setMergeError(null)
		setMergeResult(null)
		setDeleteAfterMerge(true)
	}, [])

	// Close merge modal
	const closeMergeModal = useCallback(() => {
		setMergeWorktree(null)
		setMergeError(null)
		setMergeResult(null)
	}, [])

	// Handle merge
	const handleMergeWorktree = useCallback(async () => {
		if (!mergeWorktree) return

		setIsMerging(true)
		setMergeError(null)
		setMergeResult(null)

		try {
			const result = await WorktreeServiceClient.mergeWorktree(
				MergeWorktreeRequest.create({
					worktreePath: mergeWorktree.path,
					targetBranch: getMainBranch(),
					deleteAfterMerge,
				}),
			)

			setMergeResult(result)

			if (result.success) {
				// Reload worktrees to reflect changes
				await loadWorktrees()
			} else if (!result.hasConflicts) {
				setMergeError(result.message)
			}
		} catch (err) {
			setMergeError(err instanceof Error ? err.message : "Failed to merge worktree")
		} finally {
			setIsMerging(false)
		}
	}, [mergeWorktree, getMainBranch, deleteAfterMerge, loadWorktrees])

	// Ask Cline to resolve conflicts
	const handleAskClineToResolve = useCallback(async () => {
		if (!mergeResult || !mergeResult.hasConflicts) return

		const conflictList = mergeResult.conflictingFiles.join(", ")
		const prompt = `I tried to merge branch '${mergeResult.sourceBranch}' into '${mergeResult.targetBranch}' but there are merge conflicts in the following files: ${conflictList}

Please help me resolve these merge conflicts, then complete the merge, and delete the worktree at: ${mergeWorktree?.path}`

		try {
			// Create a new task with this prompt
			await TaskServiceClient.newTask(NewTaskRequest.create({ text: prompt }))
			closeMergeModal()
			// Close worktrees view to show the chat with the new task
			onDone()
		} catch (err) {
			setMergeError(err instanceof Error ? err.message : "Failed to create task for Cline")
		}
	}, [mergeResult, mergeWorktree, closeMergeModal, onDone])

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
					their own windows so Cline can work on multiple tasks in parallel.{" "}
					<a
						className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
						href="https://docs.cline.bot/features/worktrees"
						rel="noopener noreferrer"
						style={{ fontSize: "inherit" }}
						target="_blank">
						Learn more
					</a>
				</p>

				{/* .worktreeinclude status */}
				{isGitRepo && !isMultiRoot && !isSubfolder && (
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
									href="https://docs.cline.bot/features/worktrees#worktreeinclude"
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
										href="https://docs.cline.bot/features/worktrees#worktreeinclude"
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
					<div className="flex items-center justify-center min-h-32 py-8">
						<Loader2 className="w-6 h-6 animate-spin text-[var(--vscode-descriptionForeground)]" />
						<span className="ml-2 text-[var(--vscode-descriptionForeground)]">Loading...</span>
					</div>
				) : isMultiRoot ? (
					<div className="flex flex-col items-center justify-center min-h-32 py-8 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-inputValidation-warningForeground)] mb-2 shrink-0" />
						<p className="text-[var(--vscode-foreground)] font-medium mb-1">Multi-folder workspace detected</p>
						<p className="text-[var(--vscode-descriptionForeground)] text-sm">
							Worktrees are not supported when multiple folders are open in the same workspace. Please open a single
							repository folder to use this feature.
						</p>
					</div>
				) : isSubfolder ? (
					<div className="flex flex-col items-center justify-center min-h-32 py-8 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-inputValidation-warningForeground)] mb-2 shrink-0" />
						<p className="text-[var(--vscode-foreground)] font-medium mb-1">Subfolder of a git repository</p>
						<p className="text-[var(--vscode-descriptionForeground)] text-sm">
							You have a subfolder open instead of the repository root. Please open the root folder to use
							worktrees:
						</p>
						<code className="mt-2 px-2 py-1 bg-[var(--vscode-textCodeBlock-background)] rounded text-sm break-all">
							{gitRootPath}
						</code>
					</div>
				) : !isGitRepo ? (
					<div className="flex flex-col items-center justify-center min-h-32 py-8 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-descriptionForeground)] mb-2 shrink-0" />
						<p className="text-[var(--vscode-descriptionForeground)]">
							Worktrees require a git repository. Please initialize git to use worktrees.
						</p>
					</div>
				) : error ? (
					<div className="flex flex-col items-center justify-center min-h-32 py-8 text-center">
						<AlertCircle className="w-8 h-8 text-[var(--vscode-errorForeground)] mb-2 shrink-0" />
						<p className="text-[var(--vscode-errorForeground)]">{error}</p>
						<VSCodeButton appearance="secondary" className="mt-3" onClick={loadWorktrees}>
							Retry
						</VSCodeButton>
					</div>
				) : worktrees.length === 0 ? (
					<div className="flex flex-col items-center justify-center min-h-32 py-8 text-center">
						<GitBranch className="w-8 h-8 text-[var(--vscode-descriptionForeground)] mb-2 shrink-0" />
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
												<span className="font-medium break-all">
													{worktree.branch || (worktree.isDetached ? "HEAD (detached)" : "unknown")}
												</span>
											</div>
											{isMainWorktree(worktree) && (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] cursor-help">
															Primary
														</span>
													</TooltipTrigger>
													<TooltipContent side="bottom">
														The original worktree where your .git directory lives.
													</TooltipContent>
												</Tooltip>
											)}
											{worktree.isCurrent && (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="text-xs px-1.5 py-0.5 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] cursor-help">
															Current
														</span>
													</TooltipTrigger>
													<TooltipContent side="bottom">
														This is the worktree currently open in this window.
													</TooltipContent>
												</Tooltip>
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
													<Tooltip>
														<TooltipTrigger asChild>
															<VSCodeButton
																appearance="icon"
																onClick={() => openMergeModal(worktree)}>
																<GitMerge className="w-4 h-4 text-[var(--vscode-testing-iconPassed)]" />
															</VSCodeButton>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															Merge into {getMainBranch()}
														</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<VSCodeButton
																appearance="icon"
																onClick={() => setDeleteWorktree(worktree)}>
																<Trash2 className="w-4 h-4 text-[var(--vscode-errorForeground)]" />
															</VSCodeButton>
														</TooltipTrigger>
														<TooltipContent side="bottom">Delete this worktree</TooltipContent>
													</Tooltip>
												</>
											)}
										</div>
									</div>
									{/* Path */}
									<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0 break-all">
										{worktree.path}
									</p>
								</div>
							))}
						</div>
					</>
				)}
			</div>

			{/* Fixed Bottom - New Worktree Button */}
			{isGitRepo && !isMultiRoot && !isSubfolder && (
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
			<CreateWorktreeModal onClose={() => setShowCreateForm(false)} onSuccess={loadWorktrees} open={showCreateForm} />

			{/* Delete Worktree Modal */}
			<DeleteWorktreeModal
				branchName={deleteWorktree?.branch || ""}
				onClose={() => setDeleteWorktree(null)}
				onConfirm={(deleteBranch) => handleDeleteWorktree(deleteWorktree!.path, deleteBranch, deleteWorktree!.branch)}
				open={!!deleteWorktree}
				worktreePath={deleteWorktree?.path || ""}
			/>

			{/* Merge Worktree Modal */}
			{mergeWorktree && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
					onClick={(e) => {
						if (e.target === e.currentTarget && !isMerging) {
							closeMergeModal()
						}
					}}>
					<div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-lg p-5 w-[450px] max-w-[90vw] relative">
						{/* Close button */}
						<button
							className="absolute top-3 right-3 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer"
							disabled={isMerging}
							onClick={closeMergeModal}
							type="button">
							<X className="w-4 h-4" />
						</button>

						<div className="flex items-center gap-2 mb-2">
							<GitMerge className="w-5 h-5 text-[var(--vscode-testing-iconPassed)]" />
							<h4 className="m-0 pr-6">Merge Worktree</h4>
						</div>

						{/* Success state */}
						{mergeResult?.success ? (
							<div className="flex flex-col gap-4">
								<div className="flex items-center gap-2 p-3 rounded bg-[var(--vscode-testing-iconPassed)]/10 border border-[var(--vscode-testing-iconPassed)]">
									<Check className="w-5 h-5 text-[var(--vscode-testing-iconPassed)]" />
									<p className="text-sm m-0">{mergeResult.message}</p>
								</div>
								<div className="flex justify-end">
									<VSCodeButton onClick={closeMergeModal}>Done</VSCodeButton>
								</div>
							</div>
						) : mergeResult?.hasConflicts ? (
							/* Conflict state */
							<div className="flex flex-col gap-4">
								<div className="flex items-start gap-2 p-3 rounded bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)]">
									<AlertCircle className="w-5 h-5 flex-shrink-0 text-[var(--vscode-inputValidation-warningForeground)] mt-0.5" />
									<div>
										<p className="text-sm font-medium m-0 mb-1">Merge conflicts detected</p>
										<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0 mb-2">
											The following files have conflicts:
										</p>
										<ul className="m-0 pl-4 text-sm font-mono text-[var(--vscode-descriptionForeground)]">
											{mergeResult.conflictingFiles.slice(0, 3).map((file) => (
												<li key={file}>{file}</li>
											))}
											{mergeResult.conflictingFiles.length > 3 && (
												<li className="text-[var(--vscode-descriptionForeground)]">
													...and {mergeResult.conflictingFiles.length - 3} more
												</li>
											)}
										</ul>
									</div>
								</div>

								<div className="flex flex-col gap-2">
									<VSCodeButton onClick={handleAskClineToResolve} style={{ width: "100%" }}>
										Ask Cline to Resolve
									</VSCodeButton>
									<VSCodeButton appearance="secondary" onClick={closeMergeModal} style={{ width: "100%" }}>
										I'll Resolve Manually
									</VSCodeButton>
								</div>
							</div>
						) : (
							/* Default state - confirm merge */
							<div className="flex flex-col gap-4">
								<p className="text-sm text-[var(--vscode-descriptionForeground)] m-0">
									This will merge branch{" "}
									<code className="bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">
										{mergeWorktree.branch}
									</code>{" "}
									into{" "}
									<code className="bg-[var(--vscode-textCodeBlock-background)] px-1 rounded">
										{getMainBranch()}
									</code>
									.
								</p>

								<label className="flex items-center gap-2 cursor-pointer">
									<VSCodeCheckbox
										checked={deleteAfterMerge}
										onChange={(e) => setDeleteAfterMerge((e.target as HTMLInputElement).checked)}
									/>
									<span className="text-sm">Delete worktree after successful merge</span>
								</label>

								{mergeError && (
									<div className="flex items-start gap-2 p-3 rounded bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)]">
										<AlertCircle className="w-4 h-4 flex-shrink-0 text-[var(--vscode-errorForeground)] mt-0.5" />
										<p className="text-sm text-[var(--vscode-errorForeground)] m-0">{mergeError}</p>
									</div>
								)}

								<div className="flex justify-end gap-2">
									<VSCodeButton appearance="secondary" disabled={isMerging} onClick={closeMergeModal}>
										Cancel
									</VSCodeButton>
									<VSCodeButton disabled={isMerging} onClick={handleMergeWorktree}>
										{isMerging ? (
											<>
												<Loader2 className="w-4 h-4 mr-1 animate-spin" />
												Merging...
											</>
										) : (
											<>
												<GitMerge className="w-4 h-4 mr-1" />
												Merge
											</>
										)}
									</VSCodeButton>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

export default memo(WorktreesView)
