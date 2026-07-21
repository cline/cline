"use client";

import { Check, Folder, GitBranch, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeWorkspacePath } from "@/lib/workspace-paths";

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

function workspaceName(path: string): string {
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "workspace";
}

const TRIGGER_CLASS =
	"inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PANEL_CLASS =
	"absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-popover shadow-xl";

function SearchInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	return (
		<div className="border-b border-border p-2">
			<div className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
				<Search className="size-3 shrink-0 text-muted-foreground" />
				{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
				<Input
					autoFocus
					className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					value={value}
				/>
			</div>
		</div>
	);
}

function WorkspacePicker({
	open,
	onToggle,
	onClose,
	workspaceRoot,
	workspaces,
	onRefreshWorkspaces,
	onSwitchWorkspace,
	onPickWorkspaceDirectory,
}: {
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	workspaceRoot: string;
	workspaces: string[];
	onRefreshWorkspaces: () => Promise<void>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
	onPickWorkspaceDirectory: (initialPath?: string) => Promise<string | null>;
}) {
	const [search, setSearch] = useState("");
	const [switching, setSwitching] = useState(false);
	const [picking, setPicking] = useState(false);

	const normalizedWorkspaceRoot = useMemo(
		() => normalizeWorkspacePath(workspaceRoot),
		[workspaceRoot],
	);

	// Refresh the catalog and clear the filter each time the menu opens.
	useEffect(() => {
		if (!open) return;
		setSearch("");
		void onRefreshWorkspaces();
	}, [open, onRefreshWorkspaces]);

	// The active workspace can be an excluded path (restored session, process
	// cwd fallback); register it explicitly so it stays visible while active.
	const availableWorkspaces = useMemo(() => {
		const byNormalizedPath = new Map<string, string>();
		const register = (path: string) => {
			const trimmed = path.trim();
			if (trimmed)
				byNormalizedPath.set(normalizeWorkspacePath(trimmed), trimmed);
		};
		register(workspaceRoot);
		for (const path of workspaces) register(path);
		return [...byNormalizedPath.values()];
	}, [workspaceRoot, workspaces]);

	const filteredWorkspaces = availableWorkspaces.filter((path) =>
		path.toLowerCase().includes(search.toLowerCase()),
	);

	const handleSelect = async (path: string) => {
		const next = path.trim();
		if (!next || normalizeWorkspacePath(next) === normalizedWorkspaceRoot) {
			onClose();
			return;
		}
		if (switching) return;
		setSwitching(true);
		const switched = await onSwitchWorkspace(next);
		setSwitching(false);
		if (switched) onClose();
	};

	const handleAddWorkspace = async () => {
		if (picking || switching) return;
		setPicking(true);
		try {
			const picked = await onPickWorkspaceDirectory(workspaceRoot || undefined);
			if (picked?.trim()) await handleSelect(picked.trim());
		} finally {
			setPicking(false);
		}
	};

	return (
		<div className="relative shrink-0">
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				className={TRIGGER_CLASS}
				onClick={onToggle}
				title={workspaceRoot}
				type="button"
			>
				<Folder className="size-4 shrink-0 text-muted-foreground" />
				<span className="max-w-44 truncate">
					{workspaceName(workspaceRoot)}
				</span>
			</button>

			{open && (
				<div className={PANEL_CLASS}>
					<SearchInput
						onChange={setSearch}
						placeholder="Search workspaces"
						value={search}
					/>
					<div className="p-1.5">
						<div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
							{filteredWorkspaces.length === 0 ? (
								<div className="px-2 py-2 text-xs text-muted-foreground">
									No workspaces found
								</div>
							) : (
								filteredWorkspaces.map((path) => {
									const isActive =
										normalizeWorkspacePath(path) === normalizedWorkspaceRoot;
									return (
										<Button
											className={cn(
												"flex h-auto w-full items-center justify-between rounded-md p-2 text-left",
												isActive ? "bg-accent" : "hover:bg-accent/50",
											)}
											disabled={switching}
											key={path}
											onClick={() => void handleSelect(path)}
											variant="ghost"
										>
											<span className="flex min-w-0 items-center gap-2">
												<Folder className="size-3 shrink-0 text-muted-foreground" />
												<span className="truncate text-xs text-foreground">
													{formatWorkspacePath(path)}
												</span>
											</span>
											{isActive && (
												<Check className="ml-2 size-3 shrink-0 text-foreground" />
											)}
										</Button>
									);
								})
							)}
						</div>
						<Button
							className="mt-0.5 w-full justify-start text-xs text-muted-foreground"
							disabled={switching || picking}
							onClick={() => void handleAddWorkspace()}
							size="sm"
							variant="ghost"
						>
							<Plus className="size-3" />
							{picking ? "Opening folder picker..." : "Add project..."}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function BranchPicker({
	open,
	onToggle,
	onClose,
	currentBranch,
	onListGitBranches,
	onSwitchGitBranch,
}: {
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	currentBranch: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
}) {
	const [search, setSearch] = useState("");
	const [branches, setBranches] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [switching, setSwitching] = useState(false);

	// Load branches fresh each time the menu opens.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setSearch("");
		setLoading(true);
		onListGitBranches()
			.then((payload) => {
				if (!cancelled) setBranches(payload.branches);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, onListGitBranches]);

	const hasGit = currentBranch !== "no-git";
	const branchLabel = hasGit ? currentBranch : "No branch";

	const filteredBranches = branches.filter((branch) =>
		branch.toLowerCase().includes(search.toLowerCase()),
	);

	const handleSelect = async (branch: string) => {
		if (branch === currentBranch) {
			onClose();
			return;
		}
		if (switching) return;
		setSwitching(true);
		const switched = await onSwitchGitBranch(branch);
		setSwitching(false);
		if (switched) onClose();
	};

	return (
		<div className="relative min-w-0">
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				className={cn(TRIGGER_CLASS, "min-w-0 max-w-full")}
				onClick={onToggle}
				title={branchLabel}
				type="button"
			>
				<GitBranch className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 truncate">{branchLabel}</span>
			</button>

			{open && (
				<div className={PANEL_CLASS}>
					<SearchInput
						onChange={setSearch}
						placeholder="Search branches"
						value={search}
					/>
					<div className="p-1.5">
						{loading ? (
							<div className="px-2 py-4 text-xs text-muted-foreground">
								Loading...
							</div>
						) : (
							<div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
								{filteredBranches.length === 0 ? (
									<div className="px-2 py-2 text-xs text-muted-foreground">
										No branches found
									</div>
								) : (
									filteredBranches.map((branch) => (
										<Button
											className={cn(
												"flex h-auto items-center gap-2 rounded-md px-2 py-2 text-left",
												currentBranch === branch
													? "bg-accent"
													: "hover:bg-accent/50",
											)}
											disabled={switching}
											key={branch}
											onClick={() => void handleSelect(branch)}
											variant="ghost"
										>
											<GitBranch className="size-3 shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
												{branch}
											</span>
											{currentBranch === branch && (
												<Check className="ml-auto size-3 shrink-0 text-foreground" />
											)}
										</Button>
									))
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

export function WelcomeWorkspaceControls({
	workspaceRoot,
	workspaces,
	onRefreshWorkspaces,
	onSwitchWorkspace,
	onPickWorkspaceDirectory,
	currentBranch,
	onListGitBranches,
	onSwitchGitBranch,
}: {
	workspaceRoot: string;
	workspaces: string[];
	onRefreshWorkspaces: () => Promise<void>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
	onPickWorkspaceDirectory: (initialPath?: string) => Promise<string | null>;
	currentBranch: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
}) {
	const [openMenu, setOpenMenu] = useState<"workspace" | "branch" | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Close whichever menu is open when clicking outside the control row.
	useEffect(() => {
		if (!openMenu) return;
		const handlePointerDown = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setOpenMenu(null);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [openMenu]);

	return (
		<div className="flex min-w-0 items-center gap-2" ref={containerRef}>
			<WorkspacePicker
				onClose={() => setOpenMenu(null)}
				onPickWorkspaceDirectory={onPickWorkspaceDirectory}
				onRefreshWorkspaces={onRefreshWorkspaces}
				onSwitchWorkspace={onSwitchWorkspace}
				onToggle={() =>
					setOpenMenu((current) =>
						current === "workspace" ? null : "workspace",
					)
				}
				open={openMenu === "workspace"}
				workspaceRoot={workspaceRoot}
				workspaces={workspaces}
			/>
			<BranchPicker
				currentBranch={currentBranch}
				onClose={() => setOpenMenu(null)}
				onListGitBranches={onListGitBranches}
				onSwitchGitBranch={onSwitchGitBranch}
				onToggle={() =>
					setOpenMenu((current) => (current === "branch" ? null : "branch"))
				}
				open={openMenu === "branch"}
			/>
		</div>
	);
}
