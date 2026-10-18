"use client";

import {
	ArrowLeft,
	ChevronRight,
	Code2,
	ExternalLink,
	File,
	FilePlus2,
	Folder,
	GitCompareArrows,
	Globe2,
	HardDrive,
	Loader2,
	Play,
	RefreshCw,
	Save,
	SquareTerminal,
	Trash2,
	TriangleAlert,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { Modal } from "@/components/modal";
import { Badge, EmptyState, InlineAlert, StatusBadge } from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/client-api";
import type {
	FileChangeRow,
	OpenRouterModel,
	ProjectRow,
	TaskRow,
	WorkspaceRow,
} from "@/lib/types";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

type FileEntry = {
	name: string;
	path: string;
	type: "file" | "dir";
	size: number;
	modifiedAt: string | null;
};

type TerminalEntry = {
	command: string;
	cwd: string;
	output: string;
	exitCode: number;
	durationMs: number;
	at: string;
};

type Tab = "files" | "changes" | "terminal";

function joinPath(base: string, name: string): string {
	return base ? `${base.replace(/\/$/, "")}/${name}` : name;
}

function parentPath(path: string): string {
	const parts = path.split("/").filter(Boolean);
	parts.pop();
	return parts.join("/");
}

export function WorkspaceView({
	project,
	initialWorkspace,
	initialTasks,
	initialChanges,
}: {
	project: ProjectRow;
	initialWorkspace: WorkspaceRow | null;
	initialTasks: TaskRow[];
	initialChanges: FileChangeRow[];
}) {
	const router = useRouter();
	const [workspace, setWorkspace] = useState(initialWorkspace);
	const [tasks, setTasks] = useState(initialTasks);
	const [changes, setChanges] = useState(initialChanges);
	const [tab, setTab] = useState<Tab>("files");

	const [models, setModels] = useState<OpenRouterModel[]>([]);
	const [modelsError, setModelsError] = useState<string | null>(null);
	const [loadingModels, setLoadingModels] = useState(true);
	const [modelId, setModelId] = useState(project.default_model ?? "");
	const [manualModel, setManualModel] = useState("");

	const [prompt, setPrompt] = useState("");
	const [creatingTask, setCreatingTask] = useState(false);
	const [taskError, setTaskError] = useState<string | null>(null);

	const [sandboxBusy, setSandboxBusy] = useState(false);
	const [sandboxError, setSandboxError] = useState<string | null>(null);

	const [currentDir, setCurrentDir] = useState("");
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [content, setContent] = useState("");
	const [savedContent, setSavedContent] = useState("");
	const [fileBusy, setFileBusy] = useState(false);
	const [newFileName, setNewFileName] = useState<string | null>(null);

	const [terminal, setTerminal] = useState<TerminalEntry[]>([]);
	const [command, setCommand] = useState("");
	const [cwd, setCwd] = useState("");
	const [runningCommand, setRunningCommand] = useState(false);

	const [previewOpen, setPreviewOpen] = useState(false);
	const [previewPort, setPreviewPort] = useState(String(workspace?.preview_port ?? 3000));
	const [previewUrl, setPreviewUrl] = useState(workspace?.preview_url ?? null);
	const [previewBusy, setPreviewBusy] = useState(false);
	const [previewError, setPreviewError] = useState<string | null>(null);

	const [showRelease, setShowRelease] = useState(false);
	const [revertingId, setRevertingId] = useState<string | null>(null);
	const terminalEndRef = useRef<HTMLDivElement | null>(null);

	const ready = workspace?.state === "ready" && Boolean(workspace.external_id);
	const dirty = content !== savedContent;
	const activeTask = tasks.find((task) =>
		["queued", "provisioning", "running", "waiting_approval"].includes(task.status),
	);

	useEffect(() => {
		let cancelled = false;
		apiFetch<{ models: OpenRouterModel[]; error?: string }>("/api/models?tools=1")
			.then((data) => {
				if (cancelled) return;
				setModels(data.models);
				if (data.error) setModelsError(data.error);
				if (!project.default_model && data.models.length > 0) {
					const preferred =
						data.models.find((model) => /anthropic\/claude-sonnet/i.test(model.id)) ??
						data.models.find((model) => /openai\/gpt/i.test(model.id)) ??
						data.models[0];
					setModelId(preferred.id);
				}
			})
			.catch((caught) => {
				if (!cancelled) {
					setModelsError(
						caught instanceof ApiClientError ? caught.message : "Could not load models.",
					);
				}
			})
			.finally(() => {
				if (!cancelled) setLoadingModels(false);
			});
		return () => {
			cancelled = true;
		};
	}, [project.default_model]);

	const loadFiles = useCallback(
		async (dir: string) => {
			if (!ready) return;
			setLoadingFiles(true);
			setFileError(null);
			try {
				const data = await apiFetch<{ files: FileEntry[] }>(
					`/api/projects/${project.id}/files?path=${encodeURIComponent(dir)}&depth=1`,
				);
				setFiles(data.files);
			} catch (caught) {
				setFileError(caught instanceof ApiClientError ? caught.message : "Could not list files.");
			} finally {
				setLoadingFiles(false);
			}
		},
		[project.id, ready],
	);

	useEffect(() => {
		if (tab === "files" && ready) void loadFiles(currentDir);
	}, [tab, ready, currentDir, loadFiles]);

	const loadChanges = useCallback(async () => {
		try {
			const data = await apiFetch<{ changes: FileChangeRow[] }>(
				`/api/projects/${project.id}/diffs?limit=80`,
			);
			setChanges(data.changes);
		} catch {
			// The existing list remains usable; the next refresh retries.
		}
	}, [project.id]);

	useEffect(() => {
		if (tab === "changes") void loadChanges();
	}, [tab, loadChanges]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest terminal output
	useEffect(() => {
		terminalEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [terminal, runningCommand]);

	async function startSandbox() {
		setSandboxBusy(true);
		setSandboxError(null);
		try {
			const data = await apiFetch<{ workspace: WorkspaceRow }>(
				`/api/projects/${project.id}/workspace`,
				{ method: "POST" },
			);
			setWorkspace(data.workspace);
			router.refresh();
		} catch (caught) {
			setSandboxError(
				caught instanceof ApiClientError ? caught.message : "Could not start the sandbox.",
			);
		} finally {
			setSandboxBusy(false);
		}
	}

	async function releaseSandbox() {
		setSandboxBusy(true);
		setSandboxError(null);
		try {
			await apiFetch(`/api/projects/${project.id}/workspace`, { method: "DELETE" });
			setWorkspace((current) =>
				current ? { ...current, state: "deleted", external_id: null, preview_url: null } : current,
			);
			setFiles([]);
			setSelectedPath(null);
			setShowRelease(false);
			router.refresh();
		} catch (caught) {
			setSandboxError(
				caught instanceof ApiClientError ? caught.message : "Could not release the sandbox.",
			);
		} finally {
			setSandboxBusy(false);
		}
	}

	async function openFile(path: string) {
		setFileBusy(true);
		setFileError(null);
		try {
			const data = await apiFetch<{
				path: string;
				content: string | null;
				binary: boolean;
				size: number;
			}>(`/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`);
			setSelectedPath(path);
			setContent(data.binary ? "" : (data.content ?? ""));
			setSavedContent(data.binary ? "" : (data.content ?? ""));
			if (data.binary)
				setFileError("This looks like a binary file. Use the terminal to inspect it.");
		} catch (caught) {
			setFileError(caught instanceof ApiClientError ? caught.message : "Could not open the file.");
		} finally {
			setFileBusy(false);
		}
	}

	async function saveFile() {
		if (!selectedPath) return;
		setFileBusy(true);
		setFileError(null);
		try {
			await apiFetch(`/api/projects/${project.id}/file`, {
				method: "PUT",
				body: JSON.stringify({ path: selectedPath, content }),
			});
			setSavedContent(content);
			void loadChanges();
		} catch (caught) {
			setFileError(caught instanceof ApiClientError ? caught.message : "Could not save the file.");
		} finally {
			setFileBusy(false);
		}
	}

	async function createFile() {
		if (!newFileName?.trim()) return;
		const path = joinPath(currentDir, newFileName.trim());
		setFileBusy(true);
		setFileError(null);
		try {
			await apiFetch(`/api/projects/${project.id}/file`, {
				method: "PUT",
				body: JSON.stringify({ path, content: "" }),
			});
			setNewFileName(null);
			setContent("");
			setSavedContent("");
			setSelectedPath(path);
			await loadFiles(currentDir);
			void loadChanges();
		} catch (caught) {
			setFileError(
				caught instanceof ApiClientError ? caught.message : "Could not create the file.",
			);
		} finally {
			setFileBusy(false);
		}
	}

	async function deleteFile() {
		if (!selectedPath) return;
		setFileBusy(true);
		setFileError(null);
		try {
			await apiFetch(`/api/projects/${project.id}/files?path=${encodeURIComponent(selectedPath)}`, {
				method: "DELETE",
			});
			setSelectedPath(null);
			setContent("");
			setSavedContent("");
			await loadFiles(currentDir);
			void loadChanges();
		} catch (caught) {
			setFileError(
				caught instanceof ApiClientError ? caught.message : "Could not delete the file.",
			);
		} finally {
			setFileBusy(false);
		}
	}

	async function runCommand(event: React.FormEvent) {
		event.preventDefault();
		if (!command.trim() || runningCommand) return;
		const commandToRun = command;
		setRunningCommand(true);
		const startedAt = new Date().toISOString();
		try {
			const data = await apiFetch<{
				output: string;
				exitCode: number;
				durationMs: number;
				timedOut: boolean;
			}>(`/api/projects/${project.id}/terminal`, {
				method: "POST",
				body: JSON.stringify({
					command: commandToRun,
					cwd: cwd.trim() || undefined,
					timeoutSeconds: 120,
				}),
			});
			setTerminal((current) => [
				...current,
				{
					command: commandToRun,
					cwd: cwd.trim() || ".",
					output: `${data.output}${data.timedOut ? "\n[command timed out]" : ""}`,
					exitCode: data.exitCode,
					durationMs: data.durationMs,
					at: startedAt,
				},
			]);
			setCommand("");
		} catch (caught) {
			setTerminal((current) => [
				...current,
				{
					command: commandToRun,
					cwd: cwd.trim() || ".",
					output:
						caught instanceof ApiClientError
							? caught.message
							: "The command could not be executed.",
					exitCode: 1,
					durationMs: 0,
					at: startedAt,
				},
			]);
		} finally {
			setRunningCommand(false);
		}
	}

	async function createTask(event: React.FormEvent) {
		event.preventDefault();
		const chosen = modelId || manualModel.trim();
		if (!chosen) {
			setTaskError("Choose a model or enter a model id.");
			return;
		}
		if (!prompt.trim()) return;
		setCreatingTask(true);
		setTaskError(null);
		try {
			const data = await apiFetch<{ task: TaskRow }>("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ projectId: project.id, prompt, modelId: chosen }),
			});
			setTasks((current) => [data.task, ...current]);
			setPrompt("");
			router.push(`/app/tasks/${data.task.id}`);
		} catch (caught) {
			setTaskError(caught instanceof ApiClientError ? caught.message : "Could not start the task.");
		} finally {
			setCreatingTask(false);
		}
	}

	async function requestPreview() {
		setPreviewBusy(true);
		setPreviewError(null);
		try {
			const data = await apiFetch<{ url: string }>(`/api/projects/${project.id}/preview`, {
				method: "POST",
				body: JSON.stringify({ port: Number(previewPort) }),
			});
			setPreviewUrl(data.url);
			setWorkspace((current) => (current ? { ...current, preview_url: data.url } : current));
		} catch (caught) {
			setPreviewError(
				caught instanceof ApiClientError ? caught.message : "Could not create a preview link.",
			);
		} finally {
			setPreviewBusy(false);
		}
	}

	async function revertChange(changeId: string) {
		setRevertingId(changeId);
		try {
			await apiFetch(`/api/projects/${project.id}/diffs/${changeId}/revert`, { method: "POST" });
			await loadChanges();
			if (selectedPath) await openFile(selectedPath);
		} catch (caught) {
			setFileError(
				caught instanceof ApiClientError ? caught.message : "Could not revert that change.",
			);
		} finally {
			setRevertingId(null);
		}
	}

	const breadcrumbs = useMemo(() => currentDir.split("/").filter(Boolean), [currentDir]);

	return (
		<div className="space-y-5">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<Link
						href="/app/projects"
						className="inline-flex items-center gap-1.5 text-[0.6875rem] text-mist-500 hover:text-mist-200"
					>
						<ArrowLeft className="size-3" /> Projects
					</Link>
					<h1 className="display mt-2 truncate text-2xl font-semibold sm:text-3xl">
						{project.name}
					</h1>
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<span className="chip">{project.language}</span>
						<span className="chip">{project.template}</span>
						<span className="chip">
							{project.approval_mode === "writes"
								? "approval before writes"
								: project.approval_mode === "read_only"
									? "read-only"
									: "auto-approved tools"}
						</span>
						{workspace ? <StatusBadge status={workspace.state} /> : <Badge>no sandbox</Badge>}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{ready ? (
						<>
							<button
								type="button"
								onClick={() => setPreviewOpen(true)}
								className="btn btn-secondary"
							>
								<Globe2 className="size-4" /> Preview
							</button>
							<button
								type="button"
								onClick={() => setShowRelease(true)}
								className="btn btn-ghost text-mist-500"
								disabled={sandboxBusy}
							>
								Release sandbox
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={startSandbox}
							disabled={sandboxBusy}
							className="btn btn-primary"
						>
							{sandboxBusy ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-4" />
							)}
							{sandboxBusy ? "Provisioning sandbox…" : "Start sandbox"}
						</button>
					)}
				</div>
			</header>

			{sandboxError ? <InlineAlert tone="danger">{sandboxError}</InlineAlert> : null}
			{workspace?.state === "error" && workspace.error ? (
				<InlineAlert tone="danger" title="Sandbox error">
					{workspace.error}
				</InlineAlert>
			) : null}
			{!ready && !sandboxBusy && !sandboxError ? (
				<InlineAlert tone="info" title="Sandbox not running">
					Start the workspace to browse files, open a terminal, or run the agent. Provisioning
					usually takes 30–90 seconds.
				</InlineAlert>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
				<div className="space-y-4">
					<section className="surface p-4">
						<div className="flex items-center justify-between">
							<h2 className="font-display text-sm font-semibold">New task</h2>
							{activeTask ? <StatusBadge status={activeTask.status} /> : null}
						</div>
						<form onSubmit={createTask} className="mt-3 space-y-3">
							<div>
								<label className="label" htmlFor="task-model">
									Model
								</label>
								{models.length > 0 ? (
									<select
										id="task-model"
										value={modelId}
										onChange={(event) => setModelId(event.target.value)}
										className="input"
									>
										<option value="">Select a tool-capable model</option>
										{models.map((model) => (
											<option key={model.id} value={model.id}>
												{model.name}
											</option>
										))}
									</select>
								) : (
									<input
										id="task-model"
										value={manualModel}
										onChange={(event) => setManualModel(event.target.value)}
										placeholder="provider/model-id"
										className="input font-mono"
									/>
								)}
								{loadingModels ? (
									<p className="mt-1.5 flex items-center gap-1.5 text-[0.65rem] text-mist-500">
										<Loader2 className="size-3 animate-spin" /> Loading model catalog…
									</p>
								) : modelsError ? (
									<p className="mt-1.5 text-[0.65rem] leading-relaxed text-amber-300/90">
										Catalog unavailable ({modelsError}). Enter an OpenRouter model id manually.
									</p>
								) : (
									<p className="mt-1.5 text-[0.65rem] text-mist-600">
										{models.length} tool-capable models · pricing shown in Usage
									</p>
								)}
							</div>

							<div>
								<label className="label" htmlFor="task-prompt">
									What should the agent do?
								</label>
								<textarea
									id="task-prompt"
									required
									value={prompt}
									onChange={(event) => setPrompt(event.target.value)}
									placeholder="Inspect the project, add a /health endpoint, and run the test suite."
									className="input textarea h-32"
									maxLength={20_000}
								/>
							</div>

							{taskError ? (
								<p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.7rem] leading-relaxed text-rose-200">
									{taskError}
								</p>
							) : null}

							<button
								type="submit"
								disabled={creatingTask || !prompt.trim()}
								className="btn btn-primary w-full"
							>
								{creatingTask ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Play className="size-4" />
								)}
								Run task
							</button>
							<p className="text-center text-[0.625rem] leading-relaxed text-mist-600">
								Runs on a real worker with a{" "}
								{project.approval_mode === "auto" ? "generous" : "controlled"} tool policy. You can
								cancel at any point.
							</p>
						</form>
					</section>

					<section className="surface overflow-hidden">
						<div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
							<h2 className="font-display text-sm font-semibold">Recent tasks</h2>
							<Link
								href={`/app/tasks?projectId=${project.id}`}
								className="text-[0.65rem] text-mist-500 hover:text-mist-200"
							>
								All
							</Link>
						</div>
						{tasks.length === 0 ? (
							<p className="px-4 py-6 text-center text-[0.7rem] text-mist-600">
								No tasks yet. Describe a change above.
							</p>
						) : (
							<ul className="divide-y divide-white/[0.055]">
								{tasks.map((task) => (
									<li key={task.id}>
										<Link
											href={`/app/tasks/${task.id}`}
											className="block px-4 py-2.5 transition hover:bg-white/[0.025]"
										>
											<div className="flex items-start justify-between gap-2">
												<p className="line-clamp-1 text-[0.75rem] text-mist-200">{task.title}</p>
												<StatusBadge status={task.status} className="shrink-0" />
											</div>
											<p className="mt-1 font-mono text-[0.6rem] text-mist-600">
												{formatRelativeTime(task.created_at)} · {task.files_changed} file
												{task.files_changed === 1 ? "" : "s"}
											</p>
										</Link>
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="surface p-4">
						<h2 className="font-display text-sm font-semibold">Workspace</h2>
						<dl className="mt-3 space-y-2 text-[0.7rem]">
							<div className="flex items-center justify-between gap-2">
								<dt className="text-mist-500">Provider</dt>
								<dd className="font-mono text-mist-300">{workspace?.provider ?? "daytona"}</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt className="text-mist-500">Sandbox</dt>
								<dd className="max-w-[200px] truncate font-mono text-mist-300">
									{workspace?.external_id ?? "—"}
								</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt className="text-mist-500">Root</dt>
								<dd className="font-mono text-mist-300">{workspace?.root_path ?? "workspace"}</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt className="text-mist-500">Last active</dt>
								<dd className="text-mist-300">{formatRelativeTime(workspace?.last_active_at)}</dd>
							</div>
						</dl>
					</section>
				</div>

				<section className="surface flex min-h-[640px] flex-col overflow-hidden">
					<div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
						<div className="flex items-center gap-1">
							<TabButton active={tab === "files"} onClick={() => setTab("files")} icon={Code2}>
								Explorer
							</TabButton>
							<TabButton
								active={tab === "changes"}
								onClick={() => setTab("changes")}
								icon={GitCompareArrows}
							>
								Changes
								{changes.length > 0 ? (
									<span className="rounded-full bg-white/10 px-1.5 text-[0.6rem]">
										{changes.length}
									</span>
								) : null}
							</TabButton>
							<TabButton
								active={tab === "terminal"}
								onClick={() => setTab("terminal")}
								icon={SquareTerminal}
							>
								Terminal
							</TabButton>
						</div>
						<div className="flex items-center gap-1.5">
							{tab === "files" ? (
								<>
									<button
										type="button"
										onClick={() => void loadFiles(currentDir)}
										className="btn btn-ghost size-8 px-0"
										aria-label="Refresh files"
									>
										<RefreshCw className={cn("size-3.5", loadingFiles && "animate-spin")} />
									</button>
									<button
										type="button"
										onClick={() => setNewFileName("")}
										disabled={!ready}
										className="btn btn-ghost size-8 px-0"
										aria-label="New file"
									>
										<FilePlus2 className="size-3.5" />
									</button>
								</>
							) : null}
							<span className="chip">
								<HardDrive className="size-3" /> {ready ? "sandbox live" : "offline"}
							</span>
						</div>
					</div>

					{tab === "files" ? (
						<div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]">
							<div className="border-b border-white/[0.06] lg:border-b-0 lg:border-r">
								<div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] px-2.5 py-2 font-mono text-[0.65rem]">
									<button
										type="button"
										onClick={() => setCurrentDir("")}
										className="text-mist-400 hover:text-mist-100"
									>
										workspace
									</button>
									{breadcrumbs.map((part, index) => {
										const path = breadcrumbs.slice(0, index + 1).join("/");
										return (
											<span key={path} className="flex items-center gap-1 text-mist-600">
												<ChevronRight className="size-2.5" />
												<button
													type="button"
													onClick={() => setCurrentDir(path)}
													className="hover:text-mist-200"
												>
													{part}
												</button>
											</span>
										);
									})}
								</div>

								{newFileName !== null ? (
									<div className="flex items-center gap-1 border-b border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
										<input
											value={newFileName}
											onChange={(event) => setNewFileName(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") void createFile();
												if (event.key === "Escape") setNewFileName(null);
											}}
											placeholder="new-file.ts"
											className="input h-7 flex-1 font-mono text-[0.7rem]"
										/>
										<button
											type="button"
											onClick={() => void createFile()}
											className="grid size-7 place-items-center rounded-md text-signal-300 hover:bg-white/5"
											aria-label="Create file"
										>
											<CheckIcon />
										</button>
										<button
											type="button"
											onClick={() => setNewFileName(null)}
											className="grid size-7 place-items-center rounded-md text-mist-500 hover:bg-white/5"
											aria-label="Cancel"
										>
											<X className="size-3.5" />
										</button>
									</div>
								) : null}

								<div className="max-h-[520px] overflow-y-auto py-1">
									{!ready ? (
										<p className="px-3 py-6 text-[0.7rem] leading-relaxed text-mist-600">
											Start the sandbox to browse its files.
										</p>
									) : loadingFiles ? (
										<p className="flex items-center gap-2 px-3 py-4 text-[0.7rem] text-mist-500">
											<Loader2 className="size-3 animate-spin" /> Reading directory…
										</p>
									) : files.length === 0 ? (
										<p className="px-3 py-4 text-[0.7rem] text-mist-600">
											This directory is empty.
										</p>
									) : (
										<>
											{currentDir ? (
												<button
													type="button"
													onClick={() => setCurrentDir(parentPath(currentDir))}
													className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.72rem] text-mist-500 hover:bg-white/[0.04]"
												>
													<Folder className="size-3.5" /> ..
												</button>
											) : null}
											{files.map((file) => (
												<button
													key={file.path}
													type="button"
													onClick={() =>
														file.type === "dir"
															? setCurrentDir(file.path)
															: void openFile(file.path)
													}
													className={cn(
														"flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.72rem] transition hover:bg-white/[0.04]",
														selectedPath === file.path
															? "bg-signal-500/[0.07] text-signal-200"
															: "text-mist-300",
													)}
												>
													{file.type === "dir" ? (
														<Folder className="size-3.5 shrink-0 text-mist-500" />
													) : (
														<File className="size-3.5 shrink-0 text-mist-600" />
													)}
													<span className="truncate">{file.name}</span>
													{file.type === "file" ? (
														<span className="ml-auto font-mono text-[0.55rem] text-mist-700">
															{formatBytes(file.size)}
														</span>
													) : null}
												</button>
											))}
										</>
									)}
								</div>
							</div>

							<div className="flex min-w-0 flex-col">
								<div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
									<p className="truncate font-mono text-[0.7rem] text-mist-400">
										{selectedPath ?? "No file selected"}
										{dirty ? <span className="ml-2 text-amber-400">● unsaved</span> : null}
									</p>
									<div className="flex items-center gap-1.5">
										{selectedPath ? (
											<>
												<button
													type="button"
													onClick={() => void saveFile()}
													disabled={!dirty || fileBusy}
													className="btn btn-secondary h-7 px-2 text-[0.65rem]"
												>
													{fileBusy ? (
														<Loader2 className="size-3 animate-spin" />
													) : (
														<Save className="size-3" />
													)}
													Save
												</button>
												<button
													type="button"
													onClick={() => void deleteFile()}
													disabled={fileBusy}
													className="btn btn-ghost h-7 px-2 text-[0.65rem] text-mist-500 hover:text-rose-300"
												>
													<Trash2 className="size-3" />
												</button>
											</>
										) : null}
									</div>
								</div>
								{fileError ? (
									<p className="border-b border-amber-400/10 bg-amber-400/[0.05] px-3 py-2 text-[0.7rem] text-amber-200">
										{fileError}
									</p>
								) : null}
								<div className="flex-1 overflow-auto p-2">
									{selectedPath && !dirty ? (
										<CodeEditor path={selectedPath} value={content} height="560px" readOnly />
									) : selectedPath ? (
										<CodeEditor
											path={selectedPath}
											value={content}
											onChange={setContent}
											height="560px"
										/>
									) : (
										<div className="grid h-full min-h-[420px] place-items-center px-6 text-center">
											<div>
												<FilePlus2 className="mx-auto size-6 text-mist-700" />
												<p className="mt-3 font-display text-sm font-medium text-mist-400">
													Open a file to view or edit it
												</p>
												<p className="mt-1 text-[0.7rem] text-mist-600">
													Edits are written to the real sandbox and recorded as diffs.
												</p>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
					) : null}

					{tab === "changes" ? (
						<div className="flex-1 overflow-auto p-4">
							<div className="mb-3 flex items-center justify-between">
								<p className="text-[0.7rem] text-mist-500">
									Recorded file edits, including agent writes and manual saves. Diffs are stored in
									Postgres.
								</p>
								<button
									type="button"
									onClick={() => void loadChanges()}
									className="btn btn-ghost h-7 px-2 text-[0.65rem]"
								>
									<RefreshCw className="size-3" /> Refresh
								</button>
							</div>
							{changes.length === 0 ? (
								<EmptyState
									icon={GitCompareArrows}
									title="No changes yet"
									description="When the agent edits a file, the before/after content and unified diff are stored here."
								/>
							) : (
								<div className="space-y-2.5">
									{changes.map((change) => (
										<div
											key={change.id}
											className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/20"
										>
											<div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
												<div className="flex min-w-0 items-center gap-2">
													<Badge
														tone={
															change.change_type === "delete"
																? "danger"
																: change.change_type === "revert"
																	? "warning"
																	: change.change_type === "create"
																		? "success"
																		: "info"
														}
													>
														{change.change_type}
													</Badge>
													<button
														type="button"
														onClick={() => {
															setSelectedPath(change.path);
															setTab("files");
															void openFile(change.path);
														}}
														className="truncate font-mono text-[0.7rem] text-mist-300 hover:text-signal-200"
													>
														{change.path}
													</button>
													<span className="shrink-0 text-[0.6rem] text-mist-600">
														{formatRelativeTime(change.created_at)}
													</span>
													{change.status === "reverted" ? (
														<Badge tone="warning">reverted</Badge>
													) : null}
												</div>
												{change.status !== "reverted" && change.after_content !== null ? (
													<button
														type="button"
														onClick={() => void revertChange(change.id)}
														disabled={revertingId === change.id}
														className="btn btn-ghost h-6 px-2 text-[0.6rem] text-mist-500 hover:text-rose-300"
													>
														{revertingId === change.id ? (
															<Loader2 className="size-3 animate-spin" />
														) : (
															<RefreshCw className="size-3" />
														)}
														Revert
													</button>
												) : null}
											</div>
											<pre className="max-h-72 overflow-auto p-3 font-mono text-[0.65rem] leading-relaxed">
												{(change.diff ?? "No textual diff available.")
													.split("\n")
													.slice(0, 220)
													.map((line, index) => (
														<div
															key={`${change.id}-${index}`}
															className={
																line.startsWith("+")
																	? "text-mint-400/90"
																	: line.startsWith("-")
																		? "text-rose-300/80"
																		: line.startsWith("@@")
																			? "text-iris-300"
																			: "text-mist-500"
															}
														>
															{line || " "}
														</div>
													))}
											</pre>
										</div>
									))}
								</div>
							)}
						</div>
					) : null}

					{tab === "terminal" ? (
						<div className="flex min-h-0 flex-1 flex-col bg-[#07090d]">
							<div className="flex-1 overflow-auto p-4 font-mono text-[0.72rem] leading-relaxed terminal-scroll">
								{terminal.length === 0 ? (
									<p className="text-mist-600">
										{ready
											? "Commands run inside the project's Daytona sandbox. Output, exit codes and timing are returned verbatim."
											: "Start the sandbox to open a terminal."}
									</p>
								) : (
									terminal.map((entry, index) => (
										<div key={`${entry.at}-${index}`} className="mb-4">
											<div className="flex flex-wrap items-center gap-2 text-mist-400">
												<span className="text-signal-400">$</span>
												<span className="text-mist-200">{entry.command}</span>
												<span className="text-mist-700">({entry.cwd})</span>
											</div>
											<pre
												className={cn(
													"mt-1 whitespace-pre-wrap break-words",
													entry.exitCode === 0 ? "text-mist-300" : "text-rose-300/90",
												)}
											>
												{entry.output || "(no output)"}
											</pre>
											<p className="mt-0.5 text-[0.6rem] text-mist-700">
												exit {entry.exitCode} · {entry.durationMs}ms
											</p>
										</div>
									))
								)}
								{runningCommand ? (
									<p className="flex items-center gap-2 text-mist-400">
										<Loader2 className="size-3 animate-spin" /> running…
									</p>
								) : null}
								<div ref={terminalEndRef} />
							</div>

							<form onSubmit={runCommand} className="border-t border-white/[0.07] p-2">
								<div className="mb-1.5 flex items-center gap-2">
									<input
										value={cwd}
										onChange={(event) => setCwd(event.target.value)}
										placeholder="cwd (optional)"
										className="input h-7 w-48 font-mono text-[0.65rem]"
									/>
									<button
										type="button"
										onClick={() => setTerminal([])}
										disabled={terminal.length === 0}
										className="btn btn-ghost h-7 px-2 text-[0.6rem]"
									>
										Clear
									</button>
								</div>
								<div className="flex items-center gap-2">
									<span className="font-mono text-xs text-signal-400">$</span>
									<input
										value={command}
										onChange={(event) => setCommand(event.target.value)}
										placeholder={ready ? "npm test" : "start the sandbox first"}
										disabled={!ready || runningCommand}
										className="input h-9 flex-1 font-mono text-[0.75rem]"
										autoComplete="off"
										spellCheck={false}
									/>
									<button
										type="submit"
										disabled={!ready || runningCommand || !command.trim()}
										className="btn btn-primary h-9 px-3"
									>
										{runningCommand ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<Play className="size-3.5" />
										)}
										Run
									</button>
								</div>
							</form>
						</div>
					) : null}
				</section>
			</div>

			<Modal
				open={previewOpen}
				onClose={() => setPreviewOpen(false)}
				title="Sandbox preview"
				description="Expose a port from the running sandbox. Start your dev server in the terminal first."
			>
				<div className="space-y-4">
					<div className="flex items-end gap-2">
						<div className="flex-1">
							<label className="label" htmlFor="preview-port">
								Port
							</label>
							<input
								id="preview-port"
								value={previewPort}
								onChange={(event) => setPreviewPort(event.target.value.replace(/\D/g, ""))}
								className="input font-mono"
							/>
						</div>
						<button
							type="button"
							onClick={requestPreview}
							disabled={previewBusy || !previewPort}
							className="btn btn-primary"
						>
							{previewBusy ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Globe2 className="size-4" />
							)}
							Get link
						</button>
					</div>
					{previewError ? <InlineAlert tone="danger">{previewError}</InlineAlert> : null}
					{previewUrl ? (
						<div className="rounded-lg border border-white/10 bg-black/30 p-3">
							<p className="label">Preview URL</p>
							<a
								href={previewUrl}
								target="_blank"
								rel="noreferrer"
								className="break-all font-mono text-[0.7rem] text-signal-300 hover:text-signal-200"
							>
								{previewUrl}
							</a>
							<p className="mt-2 flex items-center gap-1.5 text-[0.65rem] text-mist-500">
								<ExternalLink className="size-3" /> Opens in a new tab. The link is scoped to this
								sandbox.
							</p>
						</div>
					) : (
						<p className="flex items-start gap-2 text-[0.7rem] leading-relaxed text-mist-500">
							<TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
							Nothing is listening yet? Run something like{" "}
							<code className="font-mono text-mist-300">npm run dev -- --host 0.0.0.0</code> in the
							terminal, then request the same port here.
						</p>
					)}
				</div>
			</Modal>

			<Modal
				open={showRelease}
				onClose={() => setShowRelease(false)}
				title="Release sandbox?"
				description="The sandbox is deleted. Files in it are lost, but task history and diffs stay in the database."
			>
				<div className="space-y-4">
					<p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs leading-relaxed text-amber-200">
						Releasing stops any running process in the sandbox. Start a new sandbox later to get a
						clean workspace from the project template.
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setShowRelease(false)}
							className="btn btn-secondary"
						>
							Keep sandbox
						</button>
						<button
							type="button"
							onClick={releaseSandbox}
							disabled={sandboxBusy}
							className="btn btn-danger"
						>
							{sandboxBusy ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							Release
						</button>
					</div>
				</div>
			</Modal>
		</div>
	);
}

function TabButton({
	active,
	onClick,
	icon: Icon,
	children,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Code2;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.72rem] transition",
				active
					? "bg-white/[0.07] text-mist-50"
					: "text-mist-500 hover:bg-white/[0.04] hover:text-mist-200",
			)}
		>
			<Icon className="size-3.5" strokeWidth={1.7} />
			{children}
		</button>
	);
}

function CheckIcon() {
	return (
		<svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
			<path
				d="M3 8.5 6.2 11.5 13 4.5"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
