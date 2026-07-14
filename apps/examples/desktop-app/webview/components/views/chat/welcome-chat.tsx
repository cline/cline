"use client";

import { ArrowRight, FolderPlus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuroraBackground } from "@/components/ui/aurora-bg";
import { useWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";
import { normalizeWorkspacePath } from "@/lib/workspace-paths";

interface QuickAction {
	id: string;
	label: string;
	description: string;
	prompt: string;
}

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
	{
		id: "review-changes",
		label: "Review changes",
		description: "Review the current changes and call out anything risky.",
		prompt: "Review the current changes and call out anything risky.",
	},
	{
		id: "check-build",
		label: "Check for build errors",
		description: "Run the relevant checks and help me fix any failures.",
		prompt: "Check this project for build errors and help me fix any failures.",
	},
];

function toWorkspaceName(path: string): string {
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return "Workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "Workspace";
}

function workspaceLabels(paths: string[]): Map<string, string> {
	const segments = paths.map((path) =>
		path
			.trim()
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.filter(Boolean),
	);
	return new Map(
		paths.map((path, index) => {
			const parts = segments[index] ?? [];
			for (let depth = 1; depth <= parts.length; depth += 1) {
				const candidate = parts.slice(-depth).join("/");
				const matches = segments.filter(
					(other) => other.slice(-depth).join("/") === candidate,
				).length;
				if (matches === 1) return [path, candidate];
			}
			return [path, toWorkspaceName(path)];
		}),
	);
}

export function WelcomeScreen({
	active,
	body,
	composer,
	onStartChat,
	quickActions,
}: {
	active: boolean;
	body: ReactNode;
	composer: ReactNode;
	onStartChat: (prompt: string) => void;
	quickActions: QuickAction[];
}) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces,
		switchWorkspace,
		pickWorkspaceDirectory,
	} = useWorkspace();
	const [switchingWorkspace, setSwitchingWorkspace] = useState<string | null>(
		null,
	);
	const [addingWorkspace, setAddingWorkspace] = useState(false);
	const availableWorkspaces = useMemo(() => {
		const next = new Map<string, string>();
		const register = (path: string) => {
			const trimmed = path.trim();
			if (trimmed) next.set(normalizeWorkspacePath(trimmed), trimmed);
		};
		register(workspaceRoot);
		for (const workspacePath of workspaces) register(workspacePath);
		return [...next.values()];
	}, [workspaceRoot, workspaces]);
	const actions =
		quickActions.length > 0 ? quickActions : DEFAULT_QUICK_ACTIONS;
	const labelsByWorkspace = useMemo(
		() => workspaceLabels(availableWorkspaces),
		[availableWorkspaces],
	);

	useEffect(() => {
		if (active) void refreshWorkspaces();
	}, [active, refreshWorkspaces]);

	const handleSelectWorkspace = useCallback(
		async (path: string) => {
			if (
				normalizeWorkspacePath(path) ===
					normalizeWorkspacePath(workspaceRoot) ||
				switchingWorkspace
			) {
				return;
			}
			setSwitchingWorkspace(path);
			try {
				await switchWorkspace(path);
			} finally {
				setSwitchingWorkspace(null);
			}
		},
		[switchWorkspace, switchingWorkspace, workspaceRoot],
	);

	const handleAddWorkspace = useCallback(async () => {
		if (addingWorkspace) return;
		setAddingWorkspace(true);
		try {
			const selected = await pickWorkspaceDirectory(workspaceRoot || undefined);
			if (selected) await switchWorkspace(selected);
		} finally {
			setAddingWorkspace(false);
		}
	}, [addingWorkspace, pickWorkspaceDirectory, switchWorkspace, workspaceRoot]);

	return (
		<div
			className={cn(
				active
					? "relative h-full min-h-0 overflow-hidden bg-background"
					: "contents",
			)}
		>
			{active ? <AuroraBackground /> : null}
			<div
				className={cn(
					active
						? "relative z-10 h-full w-full overflow-x-hidden overflow-y-auto"
						: "contents",
				)}
			>
				<div
					className={cn(
						active
							? "mx-auto flex w-full max-w-[960px] flex-col px-6 pb-32 pt-[clamp(8rem,26vh,17rem)] max-[720px]:px-4 max-[720px]:pb-20 max-[720px]:pt-16"
							: "contents",
					)}
				>
					{active ? (
						<>
							<h1 className="text-balance text-center text-[clamp(2rem,3vw,2.6rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-foreground">
								What would you like to build?
							</h1>

							<div className="mt-11 flex min-w-0 items-center gap-1.5 text-sm">
								<fieldset className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1">
									<legend className="sr-only">Workspaces</legend>
									{availableWorkspaces.map((path) => {
										const isActive =
											normalizeWorkspacePath(path) ===
											normalizeWorkspacePath(workspaceRoot);
										const isSwitching = switchingWorkspace === path;
										return (
											<button
												aria-pressed={isActive}
												className={cn(
													"shrink-0 rounded-md px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
													isActive
														? "bg-foreground text-background"
														: "text-muted-foreground hover:bg-accent hover:text-foreground",
												)}
												disabled={Boolean(switchingWorkspace)}
												key={path}
												onClick={() => void handleSelectWorkspace(path)}
												title={path}
												type="button"
											>
												{isSwitching
													? "Switching..."
													: (labelsByWorkspace.get(path) ??
														toWorkspaceName(path))}
											</button>
										);
									})}
								</fieldset>
								<button
									className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[480px]:px-2"
									disabled={addingWorkspace}
									onClick={() => void handleAddWorkspace()}
									type="button"
								>
									{addingWorkspace ? (
										<FolderPlus className="size-4 animate-pulse" />
									) : (
										<Plus className="size-4" />
									)}
									New project
								</button>
							</div>
						</>
					) : null}

					<div
						className={active ? "hidden" : "h-full min-h-0 overflow-hidden"}
						key="conversation-body"
					>
						{body}
					</div>

					<div
						className={active ? "mt-4 w-full" : "z-20 shrink-0"}
						key="persistent-composer"
					>
						{composer}
					</div>

					{active ? (
						<div className="mt-11 w-full divide-y divide-border/80 overflow-hidden rounded-xl border border-border/60 bg-background/95 px-2 shadow-sm">
							{actions.map((action) => (
								<button
									className="group flex w-full items-center justify-between gap-5 px-3 py-3 text-left transition-colors hover:bg-background/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									key={action.id}
									onClick={() => onStartChat(action.prompt)}
									type="button"
								>
									<span className="min-w-0">
										<span className="block text-[15px] font-medium text-foreground">
											{action.label}
										</span>
										<span className="mt-0.5 block truncate text-sm text-muted-foreground">
											{action.description}
										</span>
									</span>
									<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
										<ArrowRight className="size-3" />
									</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
