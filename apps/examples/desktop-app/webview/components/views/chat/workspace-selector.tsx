"use client";

import { isChatWorkspacePath } from "@cline/shared/browser";
import {
	Check,
	Folder,
	FolderCode,
	GitBranch,
	Plus,
	Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { scrollCurrentOptionIntoView } from "@/lib/scroll-current-option";
import { cn } from "@/lib/utils";
import {
	looksLikeFolderPath,
	normalizeWorkspacePath,
} from "@/lib/workspace-paths";

function formatWorkspacePath(path: string): string {
	const unixHome = path.match(/^\/Users\/[^/]+\/(.*)$/);
	if (unixHome) return unixHome[1] ? `~/${unixHome[1]}` : "~";
	const linuxHome = path.match(/^\/home\/[^/]+\/(.*)$/);
	if (linuxHome) return linuxHome[1] ? `~/${linuxHome[1]}` : "~";
	const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+\\(.*)$/);
	if (windowsHome) {
		const tail = windowsHome[1]?.replaceAll("\\", "/") || "";
		return tail ? `~/${tail}` : "~";
	}
	return path;
}

export function WorkspaceSelector({
	currentBranch,
	workspaceRoot,
	onListGitBranches,
	workspaces,
	onRefreshWorkspaces,
	onSwitchGitBranch,
	onSwitchWorkspace,
	onPickWorkspaceDirectory,
	onCreateGitBranch,
	disabled = false,
}: {
	/** Branch name, "no-git" for a non-repo folder, null while discovery is pending. */
	currentBranch: string | null;
	workspaceRoot: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	workspaces: string[];
	onRefreshWorkspaces: () => Promise<void>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
	onPickWorkspaceDirectory?: (initialPath?: string) => Promise<string | null>;
	onCreateGitBranch?: (branchName: string) => Promise<boolean>;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [branches, setBranches] = useState<string[]>([]);
	const [loadingBranches, setLoadingBranches] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
	const [pickingWorkspace, setPickingWorkspace] = useState(false);
	const [showWorkspacePathInput, setShowWorkspacePathInput] = useState(false);
	const [workspacePathInput, setWorkspacePathInput] = useState("");
	const [workspaceError, setWorkspaceError] = useState<string | null>(null);
	const [showCreateBranch, setShowCreateBranch] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");
	const workspaceListRef = useRef<HTMLDivElement>(null);
	const branchListRef = useRef<HTMLDivElement>(null);

	// Start freshly opened lists at the current workspace/branch, not the top.
	useEffect(() => {
		if (!open || loadingBranches) return;
		scrollCurrentOptionIntoView(workspaceListRef.current);
		scrollCurrentOptionIntoView(branchListRef.current);
	}, [open, loadingBranches]);

	const workspaceName = useMemo(() => {
		if (isChatWorkspacePath(workspaceRoot)) {
			return "Chat";
		}
		const trimmed = workspaceRoot.trim().replace(/[\\/]+$/, "");
		if (!trimmed) {
			return "Chat";
		}
		const parts = trimmed.split(/[\\/]/);
		return parts[parts.length - 1] || "workspace";
	}, [workspaceRoot]);
	const normalizedWorkspaceRoot = useMemo(
		() => normalizeWorkspacePath(workspaceRoot),
		[workspaceRoot],
	);
	// Git chrome (branch label, branch list, create-branch) is a developer
	// affordance; a plain folder shows only folder language. Pending branch
	// discovery (null) is presented like a plain folder until it resolves.
	const hasGit = currentBranch !== null && currentBranch !== "no-git";

	const openMenu = async () => {
		if (disabled) {
			return;
		}
		setOpen(true);
		setSearch("");
		setShowWorkspacePathInput(false);
		setWorkspacePathInput("");
		setWorkspaceError(null);
		setShowCreateBranch(false);
		setNewBranchName("");
		setLoadingBranches(true);
		try {
			const [branchPayload] = await Promise.all([
				onListGitBranches(),
				onRefreshWorkspaces(),
			]);
			setBranches(branchPayload.branches);
		} finally {
			setLoadingBranches(false);
		}
	};

	const handleSelectBranch = async (branch: string) => {
		if (branch === currentBranch || switching) {
			setOpen(false);
			setSearch("");
			setShowWorkspacePathInput(false);
			setWorkspacePathInput("");
			return;
		}
		setSwitching(true);
		const switched = await onSwitchGitBranch(branch);
		setSwitching(false);
		if (switched) {
			setOpen(false);
			setSearch("");
		}
	};

	const handleWorkspaceSelect = async (nextWorkspacePath: string) => {
		const next = nextWorkspacePath.trim();
		if (
			!next ||
			normalizeWorkspacePath(next) === normalizedWorkspaceRoot ||
			switchingWorkspace
		) {
			return;
		}
		setWorkspaceError(null);
		setSwitchingWorkspace(true);
		const switched = await onSwitchWorkspace(next);
		setSwitchingWorkspace(false);
		if (switched) {
			setOpen(false);
			setSearch("");
			return;
		}
		setWorkspaceError(
			`Couldn't open "${next}". Check that the folder exists and try again.`,
		);
	};

	const handleSwitchWorkspacePath = async () => {
		if (pickingWorkspace || switchingWorkspace) {
			return;
		}
		setWorkspaceError(null);
		if (onPickWorkspaceDirectory) {
			setPickingWorkspace(true);
			try {
				const picked = await onPickWorkspaceDirectory(workspaceRoot);
				if (picked?.trim()) {
					await handleWorkspaceSelect(picked.trim());
				}
				return;
			} catch (pickError) {
				// No usable native picker — fall through to manual path entry.
				setWorkspaceError(
					pickError instanceof Error && pickError.message.trim()
						? pickError.message
						: "The folder picker could not be opened. Type a folder path instead.",
				);
			} finally {
				setPickingWorkspace(false);
			}
		}
		setShowWorkspacePathInput(true);
		setWorkspacePathInput(workspaceRoot);
	};

	const handleSubmitWorkspacePath = () => {
		const proposed = workspacePathInput.trim();
		if (!proposed) {
			return;
		}
		void handleWorkspaceSelect(proposed);
	};

	const handleCreateBranch = async () => {
		const branchName = newBranchName.trim().replace(/\s+/g, "-");
		if (!branchName) return;
		if (branches.some((b) => b === branchName)) return;

		setSwitching(true);
		const success = onCreateGitBranch
			? await onCreateGitBranch(branchName)
			: await onSwitchGitBranch(branchName);
		setSwitching(false);
		if (success) {
			setBranches((prev) => [...prev, branchName]);
			setNewBranchName("");
			setShowCreateBranch(false);
			setOpen(false);
			setSearch("");
		}
	};

	const filteredBranches = branches.filter((b) =>
		b.toLowerCase().includes(search.toLowerCase()),
	);

	// The catalog excludes non-project paths (home, Desktop, ~/.cline), but an
	// explicitly opened workspace must stay visible while it is active.
	const availableWorkspaces = useMemo(() => {
		const byNormalizedPath = new Map<string, string>();
		const register = (path: string) => {
			const trimmed = path.trim();
			if (trimmed)
				byNormalizedPath.set(normalizeWorkspacePath(trimmed), trimmed);
		};
		if (!isChatWorkspacePath(workspaceRoot)) register(workspaceRoot);
		for (const path of workspaces) register(path);
		return [...byNormalizedPath.values()];
	}, [workspaceRoot, workspaces]);

	const filteredWorkspaces = availableWorkspaces.filter((w) =>
		w.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="relative min-w-0 max-w-full">
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						className={cn(
							"inline-flex max-w-full",
							(disabled || switching) && "[&>button]:pointer-events-none",
						)}
					>
						<Button
							variant="ghost"
							aria-label={
								hasGit
									? `Workspace ${workspaceName}, branch ${currentBranch}`
									: `Folder ${workspaceName}`
							}
							className="flex max-w-full min-w-0 items-center gap-1 h-auto px-1 py-0.5 hover:text-foreground transition-colors max-[560px]:size-7 max-[560px]:justify-center max-[560px]:p-0 text-sm"
							disabled={disabled || switching}
							id="git-branch-btn"
							onClick={() => {
								if (open) {
									setOpen(false);
									setSearch("");
									setShowCreateBranch(false);
									setNewBranchName("");
									return;
								}
								void openMenu();
							}}
						>
							{hasGit ? (
								<GitBranch className="size-3" />
							) : (
								<Folder className="size-3" />
							)}
							<span className="max-w-20 shrink-0 truncate max-[560px]:sr-only">
								{workspaceName}
							</span>
							{hasGit ? (
								<>
									<span className="shrink-0 text-muted-foreground/60 max-[560px]:sr-only">
										/
									</span>
									<span className="min-w-0 truncate max-[560px]:sr-only">
										{currentBranch}
									</span>
								</>
							) : null}
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent align="end" side="top" sideOffset={6}>
					{workspaceRoot || workspaceName}
					{hasGit ? ` / ${currentBranch}` : ""}
				</TooltipContent>
			</Tooltip>

			{open && !disabled && (
				<>
					<Button
						variant="ghost"
						aria-label="Close menu"
						className="fixed inset-0 z-40 cursor-default h-auto rounded-none opacity-0"
						data-cursor="default"
						onClick={() => {
							setOpen(false);
							setShowWorkspacePathInput(false);
							setWorkspacePathInput("");
							setShowCreateBranch(false);
							setNewBranchName("");
							setSearch("");
						}}
					/>
					<div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none">
						{/* Search row, styled to match the composer's model picker */}
						<div className="flex items-center gap-2 border-b border-border px-3">
							<Search className="size-3 text-muted-foreground shrink-0" />
							<Input
								autoFocus
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder={
									hasGit ? "Search workspaces & branches" : "Search workspaces"
								}
								className="h-8 flex-1 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
							/>
						</div>

						{loadingBranches ? (
							<div className="px-3 py-4 text-xs text-muted-foreground">
								Loading...
							</div>
						) : (
							<>
								{/* Workspaces section */}
								<div className="p-1.5 border-b border-border">
									<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										Workspaces
									</div>
									{looksLikeFolderPath(search) && (
										<Button
											variant="ghost"
											disabled={switchingWorkspace}
											onClick={() => {
												void handleWorkspaceSelect(search);
											}}
											className="mb-0.5 flex h-auto w-full items-center justify-start gap-2 rounded-md p-2 text-left"
										>
											<FolderCode className="size-3 shrink-0 text-muted-foreground" />
											<span className="truncate text-xs text-foreground">
												Open folder “{search.trim()}”
											</span>
										</Button>
									)}
									<div ref={workspaceListRef} className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
										{filteredWorkspaces.length === 0 ? (
											<div className="px-2 py-2 text-xs text-muted-foreground">
												{looksLikeFolderPath(search)
													? "Press the option above to open this folder"
													: "No workspaces found — type a full folder path to add one"}
											</div>
										) : (
											filteredWorkspaces.map((wp) => {
												const isActive =
													normalizeWorkspacePath(wp) ===
													normalizedWorkspaceRoot;
												return (
													<Button
														variant="ghost"
														key={wp}
														data-current={isActive || undefined}
														disabled={switchingWorkspace}
														onClick={() => {
															void handleWorkspaceSelect(wp);
														}}
														className={cn(
															"flex items-center justify-between h-auto rounded-md p-2 text-left w-full",
															isActive
																? "bg-(--accent-4) hover:bg-(--accent-4)"
																: "hover:bg-surface-hover",
														)}
													>
														<div className="flex items-center gap-2 min-w-0 w-full">
															<FolderCode className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
															<span className="text-xs text-foreground truncate inline-flex">
																{formatWorkspacePath(wp)}
															</span>
														</div>
														{isActive && (
															<Check className="h-3 w-3 text-foreground shrink-0 ml-2" />
														)}
													</Button>
												);
											})
										)}
									</div>
									<Button
										variant="ghost"
										onClick={() => {
											void handleSwitchWorkspacePath();
										}}
										disabled={switchingWorkspace || pickingWorkspace}
										size="sm"
										className="justify-start w-full mt-0.5 text-xs text-muted-foreground"
									>
										{pickingWorkspace
											? "Opening folder picker..."
											: "Open folder..."}
									</Button>
									{showWorkspacePathInput ? (
										<div className="mt-1 flex items-center gap-1">
											<Input
												autoFocus
												value={workspacePathInput}
												onChange={(event) =>
													setWorkspacePathInput(event.target.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														event.preventDefault();
														handleSubmitWorkspacePath();
													}
													if (event.key === "Escape") {
														event.preventDefault();
														setShowWorkspacePathInput(false);
														setWorkspacePathInput("");
													}
												}}
												placeholder="/path/to/workspace"
												className="h-7 text-xs"
											/>
											<Button
												size="sm"
												variant="secondary"
												onClick={handleSubmitWorkspacePath}
												disabled={switchingWorkspace}
												className="h-7 px-2 text-xs"
											>
												Go
											</Button>
										</div>
									) : null}
									{workspaceError && (
										<div className="mt-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
											{workspaceError}
										</div>
									)}
								</div>

								{/* Branches section (git repos only) */}
								{hasGit ? (
									<div className="p-1.5">
										<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
											Branches
										</div>
										<div ref={branchListRef} className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
											{filteredBranches.length === 0 ? (
												<div className="px-2 py-2 text-xs text-muted-foreground">
													No branches found
												</div>
											) : (
												filteredBranches.map((branch) => (
													<Button
														variant="ghost"
														key={branch}
														data-current={currentBranch === branch || undefined}
														disabled={switching}
														onClick={() => {
															void handleSelectBranch(branch);
														}}
														className={cn(
															"flex items-start gap-2 h-auto rounded-md px-2 py-2 text-left",
															currentBranch === branch
																? "bg-(--accent-4) hover:bg-(--accent-4)"
																: "hover:bg-surface-hover",
														)}
													>
														<GitBranch className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2">
																<span className="text-xs font-medium text-foreground truncate">
																	{branch}
																</span>
																{currentBranch === branch && (
																	<Check className="h-3 w-3 text-foreground ml-auto shrink-0" />
																)}
															</div>
														</div>
													</Button>
												))
											)}
										</div>
									</div>
								) : null}

								{/* Create branch (git repos only) */}
								{hasGit ? (
									<div className="border-t border-border p-1.5">
										{showCreateBranch ? (
											<div className="flex flex-col gap-2 p-2">
												{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
												<Input
													autoFocus
													value={newBranchName}
													onChange={(e) => setNewBranchName(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") void handleCreateBranch();
														if (e.key === "Escape") {
															setShowCreateBranch(false);
															setNewBranchName("");
														}
													}}
													placeholder="Branch name"
													className="h-8 text-xs"
												/>
												<div className="flex items-center gap-2">
													<Button
														onClick={() => void handleCreateBranch()}
														disabled={!newBranchName.trim() || switching}
														size="sm"
														className="flex-1 text-xs"
													>
														Create
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => {
															setShowCreateBranch(false);
															setNewBranchName("");
														}}
														className="flex-1 text-xs text-muted-foreground"
													>
														Cancel
													</Button>
												</div>
											</div>
										) : (
											<Button
												variant="ghost"
												onClick={() => setShowCreateBranch(true)}
												size="sm"
												className="justify-start w-full text-xs text-muted-foreground"
											>
												<Plus className="size-3" />
												Create and checkout new branch...
											</Button>
										)}
									</div>
								) : null}
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
