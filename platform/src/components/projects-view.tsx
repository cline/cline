"use client";

import { Archive, ArrowUpRight, Boxes, Loader2, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { Badge, EmptyState, InlineAlert, StatusBadge } from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/client-api";
import type { OpenRouterModel, ProjectRow, WorkspaceRow } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { LANGUAGES, TEMPLATES } from "@/lib/validation";

type Props = {
	initialProjects: ProjectRow[];
	initialWorkspaces: WorkspaceRow[];
	openNew: boolean;
	plan: string;
};

export function ProjectsView({ initialProjects, initialWorkspaces, openNew, plan }: Props) {
	const router = useRouter();
	const [projects, setProjects] = useState(initialProjects);
	const [workspaces, setWorkspaces] = useState(initialWorkspaces);
	const [modalOpen, setModalOpen] = useState(openNew);
	const [query, setQuery] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setProjects(initialProjects), [initialProjects]);
	useEffect(() => setWorkspaces(initialWorkspaces), [initialWorkspaces]);

	const workspaceByProject = useMemo(
		() => new Map(workspaces.map((workspace) => [workspace.project_id, workspace])),
		[workspaces],
	);

	const filtered = projects.filter((project) => {
		const term = query.trim().toLowerCase();
		if (!term) return true;
		return (
			project.name.toLowerCase().includes(term) ||
			project.language.toLowerCase().includes(term) ||
			project.description.toLowerCase().includes(term)
		);
	});

	async function toggleArchive(project: ProjectRow) {
		setBusyId(project.id);
		setError(null);
		try {
			const nextStatus = project.status === "active" ? "archived" : "active";
			const data = await apiFetch<{ project: ProjectRow }>(`/api/projects/${project.id}`, {
				method: "PATCH",
				body: JSON.stringify({ status: nextStatus }),
			});
			setProjects((current) =>
				current.map((item) => (item.id === project.id ? data.project : item)),
			);
			router.refresh();
		} catch (caught) {
			setError(caught instanceof ApiClientError ? caught.message : "Could not update the project.");
		} finally {
			setBusyId(null);
		}
	}

	async function removeProject() {
		if (!deleteTarget) return;
		setBusyId(deleteTarget.id);
		setError(null);
		try {
			await apiFetch(`/api/projects/${deleteTarget.id}`, { method: "DELETE" });
			setProjects((current) => current.filter((item) => item.id !== deleteTarget.id));
			setWorkspaces((current) => current.filter((item) => item.project_id !== deleteTarget.id));
			setDeleteTarget(null);
			router.refresh();
		} catch (caught) {
			setError(caught instanceof ApiClientError ? caught.message : "Could not delete the project.");
		} finally {
			setBusyId(null);
		}
	}

	return (
		<>
			{error ? (
				<InlineAlert tone="danger" className="mb-4">
					{error}
				</InlineAlert>
			) : null}

			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="relative w-full max-w-xs">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mist-600" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search projects…"
						className="input pl-9"
					/>
				</div>
				<p className="text-[0.6875rem] text-mist-600">
					{projects.filter((project) => project.status === "active").length} active · {plan} plan
				</p>
			</div>

			{filtered.length === 0 ? (
				<EmptyState
					icon={Boxes}
					title={projects.length === 0 ? "No projects yet" : "No matches"}
					description={
						projects.length === 0
							? "Create a project to provision an isolated Daytona workspace for the agent."
							: "Try a different search term."
					}
					action={
						projects.length === 0 ? (
							<button type="button" onClick={() => setModalOpen(true)} className="btn btn-primary">
								<Plus className="size-4" /> Create project
							</button>
						) : null
					}
				/>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{filtered.map((project) => {
						const workspace = workspaceByProject.get(project.id);
						return (
							<div
								key={project.id}
								className="surface group flex flex-col p-5 transition hover:border-white/[0.14]"
							>
								<div className="flex items-start justify-between gap-3">
									<Link href={`/app/projects/${project.id}`} className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.035] font-mono text-[0.6rem] uppercase text-mist-400">
												{project.language.slice(0, 2)}
											</span>
											<Badge tone={project.status === "active" ? "success" : "muted"}>
												{project.status}
											</Badge>
										</div>
										<h3 className="mt-3 truncate font-display text-[0.95rem] font-semibold text-mist-50">
											{project.name}
										</h3>
										<p className="mt-1 line-clamp-2 min-h-8 text-[0.7rem] leading-relaxed text-mist-500">
											{project.description || "No description yet."}
										</p>
									</Link>
									<Link
										href={`/app/projects/${project.id}`}
										className="grid size-7 shrink-0 place-items-center rounded-lg text-mist-600 transition hover:bg-white/5 hover:text-signal-300"
										aria-label={`Open ${project.name}`}
									>
										<ArrowUpRight className="size-4" />
									</Link>
								</div>

								<div className="mt-4 flex flex-wrap items-center gap-1.5">
									<span className="chip">{project.language}</span>
									<span className="chip">{project.template}</span>
									{workspace ? (
										<StatusBadge status={workspace.state} />
									) : (
										<span className="chip text-mist-600">sandbox on first task</span>
									)}
								</div>

								<div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3.5">
									<span className="text-[0.65rem] text-mist-600">
										Updated {formatRelativeTime(project.updated_at)}
									</span>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() => toggleArchive(project)}
											disabled={busyId === project.id}
											className="grid size-7 place-items-center rounded-md text-mist-600 transition hover:bg-white/5 hover:text-mist-200"
											aria-label={
												project.status === "active" ? "Archive project" : "Reactivate project"
											}
											title={project.status === "active" ? "Archive" : "Reactivate"}
										>
											{busyId === project.id ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<Archive className="size-3.5" />
											)}
										</button>
										<button
											type="button"
											onClick={() => setDeleteTarget(project)}
											className="grid size-7 place-items-center rounded-md text-mist-600 transition hover:bg-rose-400/10 hover:text-rose-300"
											aria-label="Delete project"
											title="Delete project and sandbox"
										>
											<Trash2 className="size-3.5" />
										</button>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			<NewProjectModal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				onCreated={(project) => {
					setProjects((current) => [project, ...current]);
					router.push(`/app/projects/${project.id}`);
				}}
			/>

			<Modal
				open={Boolean(deleteTarget)}
				onClose={() => setDeleteTarget(null)}
				title="Delete project?"
				description="This removes the project's tasks, messages, diffs and its Daytona sandbox. It cannot be undone."
			>
				<div className="space-y-4">
					<p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-200">
						Deleting <span className="font-semibold">{deleteTarget?.name}</span> will stop any
						running work for this project.
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setDeleteTarget(null)}
							className="btn btn-secondary"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={removeProject}
							disabled={Boolean(busyId)}
							className="btn btn-danger"
						>
							{busyId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
							Delete project
						</button>
					</div>
				</div>
			</Modal>
		</>
	);
}

function NewProjectModal({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (project: ProjectRow) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [language, setLanguage] = useState("typescript");
	const [template, setTemplate] = useState("blank");
	const [approvalMode, setApprovalMode] = useState<"auto" | "writes" | "read_only">("auto");
	const [modelId, setModelId] = useState("");
	const [repoUrl, setRepoUrl] = useState("");
	const [models, setModels] = useState<OpenRouterModel[]>([]);
	const [modelsError, setModelsError] = useState<string | null>(null);
	const [loadingModels, setLoadingModels] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || models.length > 0 || loadingModels) return;
		setLoadingModels(true);
		apiFetch<{ models: OpenRouterModel[]; error?: string }>("/api/models?tools=1")
			.then((data) => {
				setModels(data.models);
				if (data.error) setModelsError(data.error);
			})
			.catch((caught) => {
				setModelsError(
					caught instanceof ApiClientError ? caught.message : "Could not load the model catalog.",
				);
			})
			.finally(() => setLoadingModels(false));
	}, [open, models.length, loadingModels]);

	useEffect(() => {
		const match = TEMPLATES.find((item) => item.id === template);
		if (match) setLanguage(match.language);
	}, [template]);

	async function create(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const data = await apiFetch<{ project: ProjectRow }>("/api/projects", {
				method: "POST",
				body: JSON.stringify({
					name,
					description,
					language,
					template,
					approvalMode,
					modelId: modelId || undefined,
					repoUrl: repoUrl.trim() || undefined,
				}),
			});
			setBusy(false);
			onClose();
			onCreated(data.project);
		} catch (caught) {
			setBusy(false);
			setError(caught instanceof ApiClientError ? caught.message : "Could not create the project.");
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="New project"
			description="21 Agent provisions the sandbox with this template on the first task."
			width="max-w-2xl"
		>
			<form onSubmit={create} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<label className="label" htmlFor="project-name">
							Name
						</label>
						<input
							id="project-name"
							required
							maxLength={80}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="checkout-service"
							className="input"
						/>
					</div>
					<div>
						<label className="label" htmlFor="project-template">
							Template
						</label>
						<select
							id="project-template"
							value={template}
							onChange={(event) => setTemplate(event.target.value)}
							className="input"
						>
							{TEMPLATES.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</div>
				</div>

				<div>
					<label className="label" htmlFor="project-repo">
						Clone a Git repository{" "}
						<span className="normal-case text-mist-600">(optional, HTTPS)</span>
					</label>
					<input
						id="project-repo"
						value={repoUrl}
						onChange={(event) => setRepoUrl(event.target.value)}
						placeholder="https://github.com/owner/repo.git"
						className="input font-mono text-[0.75rem]"
					/>
					<p className="mt-1 text-[0.65rem] text-mist-600">
						Public repositories are cloned into the sandbox on first provision. Private repos need
						credentials configured in the sandbox, which 21 Agent does not store.
					</p>
				</div>

				<div>
					<label className="label" htmlFor="project-description">
						Description
					</label>
					<textarea
						id="project-description"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="What is this project for? The agent uses this as context."
						className="input textarea h-20"
						maxLength={2000}
					/>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					<div>
						<label className="label" htmlFor="project-language">
							Language
						</label>
						<select
							id="project-language"
							value={language}
							onChange={(event) => setLanguage(event.target.value)}
							className="input"
						>
							{LANGUAGES.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="label" htmlFor="project-approval">
							Approvals
						</label>
						<select
							id="project-approval"
							value={approvalMode}
							onChange={(event) =>
								setApprovalMode(event.target.value as "auto" | "writes" | "read_only")
							}
							className="input"
						>
							<option value="auto">Auto-approve tools</option>
							<option value="writes">Ask before writes</option>
							<option value="read_only">Read-only</option>
						</select>
					</div>
					<div>
						<label className="label" htmlFor="project-model">
							Default model
						</label>
						<select
							id="project-model"
							value={modelId}
							onChange={(event) => setModelId(event.target.value)}
							className="input"
						>
							<option value="">Choose per task</option>
							{models.map((model) => (
								<option key={model.id} value={model.id}>
									{model.name}
								</option>
							))}
						</select>
					</div>
				</div>

				{loadingModels ? (
					<p className="flex items-center gap-2 text-[0.7rem] text-mist-500">
						<Loader2 className="size-3 animate-spin" /> Loading the live OpenRouter catalog…
					</p>
				) : null}
				{modelsError ? (
					<p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[0.7rem] leading-relaxed text-amber-200">
						Model catalog unavailable: {modelsError} You can still create the project and pick a
						model in the workspace.
					</p>
				) : null}

				{error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

				<div className="flex justify-end gap-2 pt-1">
					<button type="button" onClick={onClose} className="btn btn-secondary">
						Cancel
					</button>
					<button type="submit" disabled={busy || !name.trim()} className="btn btn-primary">
						{busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
						Create project
					</button>
				</div>
			</form>
		</Modal>
	);
}
