"use client";

import {
	ArrowUp,
	BookOpen,
	Cloud,
	ExternalLink,
	GitBranch,
	Loader2,
	MoreHorizontal,
	Pencil,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeTitle } from "@/components/utils";
import { formatRelativeTime } from "@/hooks/use-session-history";
import {
	type CloudModel,
	type CloudRemoteSession,
	type CloudRepository,
	cloudSessionRepoName,
	cloudSessionTimestamp,
	DEFAULT_CLOUD_MODEL_ID,
	isCloudSessionExpired,
} from "@/lib/cloud-sessions";
import { openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

const DOCS_URL = "https://docs.cline.bot";

export type NewCloudSessionInput = {
	prompt: string;
	repoUrl: string;
	modelId: string;
	title: string;
};

export function CloudSessionsHome({
	sessions,
	sessionsLoading,
	sessionsError,
	repositories,
	models,
	creating,
	createError,
	dashboardUrl,
	onRefresh,
	onCreateSession,
	onOpenSession,
	onRenameSession,
	onDeleteSession,
}: {
	sessions: CloudRemoteSession[];
	sessionsLoading: boolean;
	sessionsError: string | null;
	repositories: CloudRepository[];
	models: CloudModel[];
	creating: boolean;
	createError: string | null;
	dashboardUrl: string;
	onRefresh: () => void | Promise<void>;
	onCreateSession: (input: NewCloudSessionInput) => void | Promise<void>;
	onOpenSession: (session: CloudRemoteSession) => void;
	onRenameSession: (sessionId: string, title: string) => Promise<void>;
	onDeleteSession: (sessionId: string) => Promise<void>;
}) {
	const [prompt, setPrompt] = useState("");
	const [repoUrl, setRepoUrl] = useState("");
	const [modelId, setModelId] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<CloudRemoteSession | null>(
		null,
	);
	const [deleting, setDeleting] = useState(false);
	const [renameTarget, setRenameTarget] = useState<CloudRemoteSession | null>(
		null,
	);
	const [renameTitle, setRenameTitle] = useState("");
	const [renaming, setRenaming] = useState(false);

	const sortedSessions = useMemo(
		() =>
			sessions
				.slice()
				.sort(
					(left, right) =>
						(cloudSessionTimestamp(right.updatedAt ?? right.createdAt) ?? 0) -
						(cloudSessionTimestamp(left.updatedAt ?? left.createdAt) ?? 0),
				),
		[sessions],
	);

	const selectedRepoUrl =
		repoUrl || repositories[0]?.htmlUrl || repositories[0]?.cloneUrl || "";
	const selectedModelId =
		modelId ||
		models.find((model) => model.id === DEFAULT_CLOUD_MODEL_ID)?.id ||
		models[0]?.id ||
		DEFAULT_CLOUD_MODEL_ID;
	const canSubmit = prompt.trim().length > 0 && !!selectedRepoUrl && !creating;

	const submit = () => {
		if (!canSubmit) {
			return;
		}
		const trimmed = prompt.trim();
		void onCreateSession({
			prompt: trimmed,
			repoUrl: selectedRepoUrl,
			modelId: selectedModelId,
			title: trimmed.split("\n")[0]?.slice(0, 70) || "Cloud session",
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-10">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="flex items-center gap-2.5 text-[26px] font-semibold text-foreground">
							<Cloud className="size-6 text-primary" />
							Cloud Sessions
						</h1>
						<p className="mt-1.5 text-[15px] text-muted-foreground">
							Run Cline on your repositories in the cloud — sessions keep
							working after you close the app.
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Button
							aria-label="Learn about Cloud Sessions"
							onClick={() => void openExternalUrl(DOCS_URL)}
							size="icon"
							title="Cloud Sessions docs"
							type="button"
							variant="ghost"
						>
							<BookOpen className="size-4" />
						</Button>
						<Button
							aria-label="Open Cline dashboard"
							onClick={() => void openExternalUrl(dashboardUrl)}
							size="icon"
							title="Open Cline dashboard"
							type="button"
							variant="ghost"
						>
							<ExternalLink className="size-4" />
						</Button>
						<Button
							aria-label="Refresh sessions"
							disabled={sessionsLoading}
							onClick={() => void onRefresh()}
							size="icon"
							title="Refresh"
							type="button"
							variant="ghost"
						>
							<RefreshCw
								className={cn("size-4", sessionsLoading && "animate-spin")}
							/>
						</Button>
					</div>
				</div>

				{/* New session composer */}
				<div className="mt-8 rounded-xl border border-border bg-card shadow-sm">
					<Textarea
						className="min-h-24 resize-none border-0 bg-transparent px-4 pt-4 text-[15px] shadow-none focus-visible:ring-0"
						disabled={creating}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submit();
							}
						}}
						placeholder="Describe a task to run in the cloud... (⌘⏎ to start)"
						value={prompt}
					/>
					<div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2.5">
						<Select
							disabled={creating || repositories.length === 0}
							onValueChange={setRepoUrl}
							value={selectedRepoUrl}
						>
							<SelectTrigger
								aria-label="Repository"
								className="h-8 w-56 max-w-full gap-1.5 text-[13px]"
							>
								<GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
								<SelectValue placeholder="Pick a repository" />
							</SelectTrigger>
							<SelectContent>
								{repositories.map((repository) => {
									const value = repository.htmlUrl || repository.cloneUrl || "";
									if (!value) {
										return null;
									}
									return (
										<SelectItem key={value} value={value}>
											{repository.fullName || repository.name || value}
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
						<Select
							disabled={creating || models.length === 0}
							onValueChange={setModelId}
							value={selectedModelId}
						>
							<SelectTrigger
								aria-label="Model"
								className="h-8 w-52 max-w-full text-[13px]"
							>
								<SelectValue placeholder="Model" />
							</SelectTrigger>
							<SelectContent>
								{models.map((model) => (
									<SelectItem key={model.id} value={model.id}>
										{model.name}
									</SelectItem>
								))}
								{models.length === 0 ? (
									<SelectItem value={DEFAULT_CLOUD_MODEL_ID}>
										{DEFAULT_CLOUD_MODEL_ID}
									</SelectItem>
								) : null}
							</SelectContent>
						</Select>
						<div className="ml-auto">
							<Button
								aria-label="Start cloud session"
								disabled={!canSubmit}
								onClick={submit}
								size="icon"
								title="Start cloud session"
								type="button"
							>
								{creating ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<ArrowUp className="size-4" />
								)}
							</Button>
						</div>
					</div>
				</div>
				{creating ? (
					<p className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						Provisioning a cloud sandbox — this can take up to a minute...
					</p>
				) : null}
				{createError ? (
					<p className="mt-2.5 text-sm text-destructive" role="alert">
						{createError}
					</p>
				) : null}
				{repositories.length === 0 && !sessionsLoading ? (
					<p className="mt-2.5 text-sm text-muted-foreground">
						No repositories available. Grant the Cline GitHub App access to
						repositories on the dashboard, then refresh.
					</p>
				) : null}

				{/* Session list */}
				<div className="mt-10">
					<h2 className="text-sm font-medium text-muted-foreground">
						Recent cloud sessions
					</h2>
					{sessionsError ? (
						<p className="mt-3 text-sm text-destructive" role="alert">
							{sessionsError}
						</p>
					) : null}
					{sessionsLoading && sortedSessions.length === 0 ? (
						<div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Loading cloud sessions...
						</div>
					) : sortedSessions.length === 0 && !sessionsError ? (
						<div className="mt-3 rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
							No cloud sessions yet. Describe a task in the box to start your
							first one.
						</div>
					) : (
						<ul className="mt-3 flex flex-col gap-2">
							{sortedSessions.map((session) => (
								<CloudSessionRow
									key={session.id}
									onDelete={() => setDeleteTarget(session)}
									onOpen={() => onOpenSession(session)}
									onRename={() => {
										setRenameTarget(session);
										setRenameTitle(session.title ?? "");
									}}
									session={session}
								/>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* Delete confirmation */}
			<AlertDialog
				onOpenChange={(open) => {
					if (!open && !deleting) {
						setDeleteTarget(null);
					}
				}}
				open={deleteTarget !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete cloud session?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes &quot;
							{normalizeTitle(deleteTarget?.title ?? "this session")}&quot; and
							its sandbox in the cloud. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleting}
							onClick={(event) => {
								event.preventDefault();
								if (!deleteTarget) {
									return;
								}
								setDeleting(true);
								void onDeleteSession(deleteTarget.id).finally(() => {
									setDeleting(false);
									setDeleteTarget(null);
								});
							}}
						>
							{deleting ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Deleting...
								</>
							) : (
								"Delete"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Rename dialog */}
			<AlertDialog
				onOpenChange={(open) => {
					if (!open && !renaming) {
						setRenameTarget(null);
					}
				}}
				open={renameTarget !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Rename cloud session</AlertDialogTitle>
						<AlertDialogDescription>
							Give this session a name that describes the task.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Input
						autoFocus
						disabled={renaming}
						onChange={(event) => setRenameTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && renameTarget && renameTitle.trim()) {
								event.preventDefault();
								setRenaming(true);
								void onRenameSession(
									renameTarget.id,
									renameTitle.trim(),
								).finally(() => {
									setRenaming(false);
									setRenameTarget(null);
								});
							}
						}}
						placeholder="Session title"
						value={renameTitle}
					/>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={renaming}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={renaming || !renameTitle.trim()}
							onClick={(event) => {
								event.preventDefault();
								if (!renameTarget) {
									return;
								}
								setRenaming(true);
								void onRenameSession(
									renameTarget.id,
									renameTitle.trim(),
								).finally(() => {
									setRenaming(false);
									setRenameTarget(null);
								});
							}}
						>
							{renaming ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Renaming...
								</>
							) : (
								"Rename"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function CloudSessionRow({
	session,
	onOpen,
	onRename,
	onDelete,
}: {
	session: CloudRemoteSession;
	onOpen: () => void;
	onRename: () => void;
	onDelete: () => void;
}) {
	const expired = isCloudSessionExpired(session);
	const repoName = cloudSessionRepoName(session);
	const updatedAtMs = cloudSessionTimestamp(
		session.updatedAt ?? session.createdAt,
	);

	return (
		<li className="group relative">
			<button
				className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
				onClick={onOpen}
				type="button"
			>
				<span
					aria-hidden="true"
					className={cn(
						"size-2 shrink-0 rounded-full",
						expired ? "bg-muted-foreground/40" : "bg-emerald-500",
					)}
					title={expired ? "Expired" : "Active"}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[15px] font-medium text-foreground">
						{normalizeTitle(session.title || "Untitled session")}
					</span>
					<span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
						{repoName ? (
							<span className="inline-flex min-w-0 items-center gap-1">
								<GitBranch className="size-3 shrink-0" />
								<span className="truncate">{repoName}</span>
							</span>
						) : null}
						{session.modelId ? (
							<span className="truncate max-[560px]:hidden">
								{session.modelId}
							</span>
						) : null}
					</span>
				</span>
				{expired ? (
					<Badge className="shrink-0" variant="secondary">
						Expired
					</Badge>
				) : null}
				<span className="shrink-0 text-xs text-muted-foreground">
					{updatedAtMs
						? formatRelativeTime(new Date(updatedAtMs).toISOString())
						: ""}
				</span>
			</button>
			<div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label="Session actions"
							className="size-7 bg-card"
							size="icon"
							type="button"
							variant="outline"
						>
							<MoreHorizontal className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-36">
						<DropdownMenuItem onSelect={onRename}>
							<Pencil className="size-4" />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onDelete} variant="destructive">
							<Trash2 className="size-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</li>
	);
}
