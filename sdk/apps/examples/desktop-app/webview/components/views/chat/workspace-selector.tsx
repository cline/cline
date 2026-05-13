"use client";

import { Check, FolderCode, GitBranch, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

function normalizeWorkspacePath(path: string): string {
	const normalized = path.trim().replace(/[\\/]+$/, "");
	if (!normalized) {
		return "";
	}
	if (/^[A-Za-z]:/.test(normalized)) {
		return normalized.toLowerCase();
	}
	return normalized;
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
}: {
	currentBranch: string;
	workspaceRoot: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	workspaces: string[];
	onRefreshWorkspaces: () => Promise<void>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
	onPickWorkspaceDirectory?: (initialPath?: string) => Promise<string | null>;
	onCreateGitBranch?: (branchName: string) => Promise<boolean>;
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
	const [showCreateBranch, setShowCreateBranch] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");

	const workspaceName = useMemo(() => {
		const trimmed = workspaceRoot.trim().replace(/[\\/]+$/, "");
		if (!trimmed) {
			return "workspace";
		}
		const parts = trimmed.split(/[\\/]/);
		return parts[parts.length - 1] || "workspace";
	}, [workspaceRoot]);
	const normalizedWorkspaceRoot = useMemo(
		() => normalizeWorkspacePath(workspaceRoot),
		[workspaceRoot],
	);

	const openMenu = async () => {
		setOpen(true);
		setSearch("");
		setShowWorkspacePathInput(false);
		setWorkspacePathInput("");
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
		setSwitchingWorkspace(true);
		const switched = await onSwitchWorkspace(next);
		setSwitchingWorkspace(false);
		if (switched) {
			setOpen(false);
			setSearch("");
		}
	};

	const handleSwitchWorkspacePath = async () => {
		if (pickingWorkspace || switchingWorkspace) {
			return;
		}
		if (onPickWorkspaceDirectory) {
			setPickingWorkspace(true);
			try {
				const picked = await onPickWorkspaceDirectory(workspaceRoot);
				if (picked?.trim()) {
					await handleWorkspaceSelect(picked.trim());
				}
			} finally {
				setPickingWorkspace(false);
			}
			return;
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

	const filteredWorkspaces = workspaces.filter((w) =>
		w.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="relative">
			<Button
				variant="ghost"
				className="flex items-center gap-1 h-auto px-1 py-0.5 hover:text-foreground transition-colors"
				disabled={switching}
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
				<GitBranch className="size-3" />
				<span className="max-w-20 truncate">{workspaceName}</span>
				<span className="text-muted-foreground/60">/</span>
				<span className="max-w-20 truncate">{currentBranch}</span>
			</Button>

			{open && (
				<>
					<Button
						variant="ghost"
						aria-label="Close menu"
						className="fixed inset-0 z-40 cursor-default h-auto rounded-none opacity-0"
						onClick={() => {
							setOpen(false);
							setShowWorkspacePathInput(false);
							setWorkspacePathInput("");
							setShowCreateBranch(false);
							setNewBranchName("");
							setSearch("");
						}}
					/>
					<div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-border bg-popover shadow-xl">
						{/* Search */}
						<div className="p-2 border-b border-border">
							<div className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
								<Search className="size-3 text-muted-foreground shrink-0" />
								{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
								<Input
									autoFocus
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search workspaces & branches"
									className="flex-1 h-auto border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
								/>
							</div>
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
									<div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
										{filteredWorkspaces.length === 0 ? (
											<div className="px-2 py-2 text-xs text-muted-foreground">
												No workspaces found
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
														disabled={switchingWorkspace}
														onClick={() => {
															void handleWorkspaceSelect(wp);
														}}
														className={cn(
															"flex items-center justify-between h-auto rounded-md p-2 text-left w-full",
															isActive ? "bg-accent" : "hover:bg-accent/50",
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
											: "Switch workspace path..."}
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
								</div>

								{/* Branches section */}
								<div className="p-1.5">
									<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										Branches
									</div>
									<div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
										{filteredBranches.length === 0 ? (
											<div className="px-2 py-2 text-xs text-muted-foreground">
												No branches found
											</div>
										) : (
											filteredBranches.map((branch) => (
												<Button
													variant="ghost"
													key={branch}
													disabled={switching}
													onClick={() => {
														void handleSelectBranch(branch);
													}}
													className={cn(
														"flex items-start gap-2 h-auto rounded-md px-2 py-2 text-left",
														currentBranch === branch
															? "bg-accent"
															: "hover:bg-accent/50",
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

								{/* Create branch */}
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
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
