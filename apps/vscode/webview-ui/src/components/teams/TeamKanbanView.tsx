import { EmptyRequest, StringRequest } from "@shared/proto/bedrock_coder/common"
import type { TeamAgent, TeamBoard, TeamTask } from "@shared/proto/bedrock_coder/team"
import { CancelTeamRunRequest, CreateTeamTaskRequest, UpdateTeamTaskRequest } from "@shared/proto/bedrock_coder/team"
import { SwitchWorktreeRequest, type Worktree } from "@shared/proto/bedrock_coder/worktree"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Bot, ExternalLink, GitBranch, Loader2, Plus, Square, UserRound, X } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { TaskServiceClient, TeamServiceClient, WorktreeServiceClient } from "@/services/grpc-client"

type Props = { onDone: () => void }

const COLUMNS = [
	["backlog", "Backlog"],
	["ready", "Ready"],
	["in-progress", "In Progress"],
	["blocked", "Blocked"],
	["review", "Review"],
	["done", "Done"],
] as const

function formatAge(value: string): string {
	const time = Date.parse(value)
	if (!Number.isFinite(time)) return "unknown"
	const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
	if (seconds < 60) return `${seconds}s ago`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d ago`
}

const TeamKanbanView = ({ onDone }: Props) => {
	const [board, setBoard] = useState<TeamBoard>()
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string>()
	const [showCreate, setShowCreate] = useState(false)
	const [title, setTitle] = useState("")
	const [description, setDescription] = useState("")
	const [expandedTaskId, setExpandedTaskId] = useState<string>()
	const [worktrees, setWorktrees] = useState<Worktree[]>([])

	const loadBoard = useCallback(async () => {
		try {
			const next = await TeamServiceClient.getTeamBoard(EmptyRequest.create({}))
			setBoard(next)
			setError(next.error || undefined)
			const worktreeList = await WorktreeServiceClient.listWorktrees(EmptyRequest.create({}))
			setWorktrees(worktreeList.worktrees)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadBoard()
		const unsubscribe = TeamServiceClient.subscribeToTeamBoard(EmptyRequest.create({}), {
			onResponse: (next) => {
				setBoard(next)
				setError(next.error || undefined)
			},
			onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
			onComplete: () => {},
		})
		return unsubscribe
	}, [loadBoard])

	const agents = useMemo(() => new Map((board?.agents ?? []).map((agent) => [agent.agentId, agent] as const)), [board?.agents])

	const updateTask = useCallback(
		async (task: TeamTask, updates: Partial<UpdateTeamTaskRequest>) => {
			try {
				await TeamServiceClient.updateTeamTask(
					UpdateTeamTaskRequest.create({
						taskId: task.id,
						expectedRevision: task.revision,
						...updates,
					}),
				)
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause))
				await loadBoard()
			}
		},
		[loadBoard],
	)

	const createTask = useCallback(async () => {
		if (!title.trim()) return
		try {
			await TeamServiceClient.createTeamTask(
				CreateTeamTaskRequest.create({
					title: title.trim(),
					description: description.trim() || undefined,
				}),
			)
			setTitle("")
			setDescription("")
			setShowCreate(false)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		}
	}, [description, title])

	const openChat = useCallback(
		async (task: TeamTask) => {
			if (!task.sessionId) return
			await TaskServiceClient.showTaskWithId(StringRequest.create({ value: task.sessionId }))
			onDone()
		},
		[onDone],
	)

	const openWorktree = useCallback(async (task: TeamTask) => {
		if (!task.worktreePath) return
		await WorktreeServiceClient.switchWorktree(SwitchWorktreeRequest.create({ path: task.worktreePath, newWindow: true }))
	}, [])

	const cancelRun = useCallback(
		async (task: TeamTask) => {
			const run = board?.runs.find(
				(candidate) => candidate.taskId === task.id && ["queued", "running"].includes(candidate.status),
			)
			if (!run) return
			await TeamServiceClient.cancelTeamRun(
				CancelTeamRunRequest.create({ runId: run.id, reason: "Cancelled from local Kanban" }),
			)
		},
		[board?.runs],
	)

	const editTask = useCallback(
		async (task: TeamTask) => {
			const nextTitle = window.prompt("Task title", task.title)
			if (nextTitle === null || !nextTitle.trim()) return
			const nextDescription = window.prompt("Task description", task.description ?? "")
			if (nextDescription === null) return
			await updateTask(task, {
				title: nextTitle.trim(),
				description: nextDescription.trim() || undefined,
				clearDescription: !nextDescription.trim(),
			})
		},
		[updateTask],
	)

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden bg-[var(--vscode-editor-background)]">
			<div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-4 py-3">
				<div>
					<h3 className="m-0">Local Teams</h3>
					<p className="m-0 mt-1 text-xs text-[var(--vscode-descriptionForeground)]">
						{board?.teamName || "Current workspace"} · {board?.agents.length ?? 0} agents · local only
					</p>
				</div>
				<div className="flex gap-2">
					<VSCodeButton appearance="secondary" onClick={() => setShowCreate(true)}>
						<Plus className="mr-1 h-4 w-4" /> Task
					</VSCodeButton>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
			</div>

			{error && (
				<div className="border-b border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] px-4 py-2 text-sm text-[var(--vscode-errorForeground)]">
					{error}
				</div>
			)}

			{showCreate && (
				<div className="flex flex-wrap items-end gap-2 border-b border-[var(--vscode-panel-border)] p-3">
					<VSCodeTextField onInput={(event) => setTitle((event.target as HTMLInputElement).value)} value={title}>
						Title
					</VSCodeTextField>
					<VSCodeTextField
						onInput={(event) => setDescription((event.target as HTMLInputElement).value)}
						value={description}>
						Description
					</VSCodeTextField>
					<VSCodeButton onClick={createTask}>Create in Backlog</VSCodeButton>
					<VSCodeButton appearance="icon" onClick={() => setShowCreate(false)}>
						<X className="h-4 w-4" />
					</VSCodeButton>
				</div>
			)}

			{loading ? (
				<div className="flex flex-1 items-center justify-center">
					<Loader2 className="h-5 w-5 animate-spin" />
				</div>
			) : (
				<div className="flex flex-1 gap-3 overflow-x-auto p-3">
					{COLUMNS.map(([status, label]) => {
						const tasks = (board?.tasks ?? []).filter((task) => task.status === status)
						return (
							<section
								className="flex min-w-[260px] flex-1 flex-col rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]"
								key={status}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									const task = board?.tasks.find(
										(candidate) => candidate.id === event.dataTransfer.getData("text/task-id"),
									)
									if (task && task.status !== status) void updateTask(task, { status })
								}}>
								<header className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2 text-sm font-semibold">
									<span>{label}</span>
									<span className="rounded bg-[var(--vscode-badge-background)] px-1.5 text-[var(--vscode-badge-foreground)]">
										{tasks.length}
									</span>
								</header>
								<div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
									{tasks.map((task) => {
										const agent = task.assignedAgentId ? agents.get(task.assignedAgentId) : undefined
										const run = board?.runs.find((candidate) => candidate.taskId === task.id)
										return (
											<article
												className="cursor-grab rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] p-3"
												draggable
												key={task.id}
												onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}>
												<div className="font-medium">{task.title}</div>
												<div className="mt-2 flex items-center gap-1 text-xs text-[var(--vscode-descriptionForeground)]">
													{agent ? (
														<Bot className="h-3.5 w-3.5" />
													) : (
														<UserRound className="h-3.5 w-3.5" />
													)}
													<select
														className="min-w-0 flex-1 bg-[var(--vscode-dropdown-background)]"
														onChange={(event) =>
															void updateTask(task, {
																assignedAgentId: event.target.value || undefined,
																clearAssignedAgent: !event.target.value,
															})
														}
														value={task.assignedAgentId ?? ""}>
														<option value="">Unassigned</option>
														{board?.agents
															.filter((candidate) => candidate.role === "teammate")
															.map((candidate: TeamAgent) => (
																<option key={candidate.agentId} value={candidate.agentId}>
																	{candidate.displayLabel}
																</option>
															))}
													</select>
												</div>
												{run && <div className="mt-2 text-xs">Run: {run.status}</div>}
												{task.branch && (
													<div className="mt-1 flex items-center gap-1 truncate text-xs">
														<GitBranch className="h-3 w-3" /> {task.branch}
													</div>
												)}
												<select
													className="mt-2 w-full bg-[var(--vscode-dropdown-background)] text-xs"
													onChange={(event) => {
														const selected = worktrees.find(
															(worktree) => worktree.path === event.target.value,
														)
														void updateTask(task, {
															worktreePath: selected?.path,
															branch: selected?.branch,
															clearWorktree: !selected,
															clearBranch: !selected,
														})
													}}
													value={task.worktreePath ?? ""}>
													<option value="">No assigned worktree</option>
													{worktrees.map((worktree) => (
														<option key={worktree.path} value={worktree.path}>
															{worktree.branch || "detached"} — {worktree.path}
														</option>
													))}
												</select>
												{(task.blocker || task.summary) && (
													<p className="mb-0 mt-2 line-clamp-3 text-xs text-[var(--vscode-descriptionForeground)]">
														{task.blocker || task.summary}
													</p>
												)}
												<div className="mt-2 text-[10px] text-[var(--vscode-descriptionForeground)]">
													Updated {formatAge(task.updatedAt)}
												</div>
												<div className="mt-2 flex flex-wrap gap-1">
													{task.sessionId && (
														<VSCodeButton
															appearance="icon"
															onClick={() => void openChat(task)}
															title="Open chat">
															<ExternalLink className="h-3.5 w-3.5" />
														</VSCodeButton>
													)}
													{task.worktreePath && (
														<VSCodeButton
															appearance="secondary"
															onClick={() => void openWorktree(task)}
															title="Open worktree">
															<GitBranch className="h-3.5 w-3.5" />
														</VSCodeButton>
													)}
													{run && ["queued", "running"].includes(run.status) && (
														<VSCodeButton
															appearance="secondary"
															onClick={() => void cancelRun(task)}
															title="Cancel work">
															<Square className="h-3.5 w-3.5" />
														</VSCodeButton>
													)}
													<VSCodeButton
														appearance="secondary"
														onClick={() =>
															setExpandedTaskId(expandedTaskId === task.id ? undefined : task.id)
														}>
														Details
													</VSCodeButton>
													<VSCodeButton appearance="secondary" onClick={() => void editTask(task)}>
														Edit
													</VSCodeButton>
												</div>
												{expandedTaskId === task.id && (
													<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--vscode-textCodeBlock-background)] p-2 text-[10px]">
														{JSON.stringify({ task, agent, run }, null, 2)}
													</pre>
												)}
											</article>
										)
									})}
								</div>
							</section>
						)
					})}
				</div>
			)}
		</div>
	)
}

export default memo(TeamKanbanView)
