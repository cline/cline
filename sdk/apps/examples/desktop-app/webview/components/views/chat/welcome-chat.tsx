"use client";

import { Check, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/contexts/workspace-context";

interface QuickAction {
	id: string;
	label: string;
	description: string;
	prompt: string;
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
function toWorkspaceName(path: string): string {
	const trimmed = path.trim().replace(/[\\/]+$/, "");
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "workspace";
}

function formatWorkspaceLabel(workspacePath: string): string {
	const trimmed = workspacePath.trim();
	if (!trimmed) return workspacePath;
	const unixHome = trimmed.match(/^\/Users\/[^/]+\/(.*)$/);
	if (unixHome) return unixHome[1] ? `~/${unixHome[1]}` : "~";
	const linuxHome = trimmed.match(/^\/home\/[^/]+\/(.*)$/);
	if (linuxHome) return linuxHome[1] ? `~/${linuxHome[1]}` : "~";
	const windowsHome = trimmed.match(/^[A-Za-z]:\\Users\\[^\\]+\\(.*)$/);
	if (windowsHome) {
		const tail = windowsHome[1]?.replaceAll("\\", "/") || "";
		return tail ? `~/${tail}` : "~";
	}
	return workspacePath;
}

export function WelcomeScreen({
	quickActions,
}: {
	provider: string;
	model: string;
	onStartChat: (prompt: string) => void;
	quickActions: QuickAction[];
}) {
	const { workspaceRoot, workspaces, refreshWorkspaces, switchWorkspace } =
		useWorkspace();
	const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
	const availableWorkspaces = useMemo(() => {
		const next = new Map<string, string>();
		const register = (path: string) => {
			const trimmed = path.trim();
			if (!trimmed) {
				return;
			}
			next.set(normalizeWorkspacePath(trimmed), trimmed);
		};
		register(workspaceRoot);
		for (const workspacePath of workspaces) {
			register(workspacePath);
		}
		return [...next.values()];
	}, [workspaceRoot, workspaces]);

	useEffect(() => {
		void refreshWorkspaces();
	}, [refreshWorkspaces]);

	const handleSelectWorkspace = useCallback(
		async (path: string) => {
			if (
				normalizeWorkspacePath(path) ===
					normalizeWorkspacePath(workspaceRoot) ||
				switchingWorkspace
			)
				return;
			setSwitchingWorkspace(true);
			await switchWorkspace(path);
			setSwitchingWorkspace(false);
		},
		[workspaceRoot, switchWorkspace, switchingWorkspace],
	);

	const handleQuickAction = (action: QuickAction) => {
		// TODO: wire up quick action prompt to chat input
		void action;
	};

	return (
		<div className="flex flex-1 flex-col items-center overflow-hidden bg-background">
			<div className="relative z-10 flex w-full max-w-3xl flex-1 flex-col items-center px-6 py-12">
				<div className="mb-8 flex flex-col items-center">
					<h1 className="text-balance text-center text-3xl font-bold tracking-tight text-foreground">
						What would you like to build?
					</h1>
					<p className="mt-2 text-balance text-center text-muted-foreground">
						Start a conversation to explore, edit, and ship code together.
					</p>
				</div>

				{/* Workspace selector */}
				<div className="mb-8 w-full max-w-md">
					<Label className="mb-2 block text-xs font-medium text-muted-foreground">
						Workspace
					</Label>
					<Command className="rounded-xl border border-border bg-card">
						<CommandInput placeholder="Search workspaces..." />
						<CommandList>
							<CommandEmpty>No workspaces found.</CommandEmpty>
							<CommandGroup>
								{availableWorkspaces.map((wsPath) => {
									const isActive =
										normalizeWorkspacePath(wsPath) ===
										normalizeWorkspacePath(workspaceRoot);
									return (
										<CommandItem
											key={wsPath}
											value={wsPath}
											onSelect={() => {
												void handleSelectWorkspace(wsPath);
											}}
											disabled={switchingWorkspace}
											className="gap-3 py-2.5"
										>
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
												<FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<p className="truncate text-sm font-medium text-foreground">
														{toWorkspaceName(wsPath)}
													</p>
													{isActive && (
														<span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
															Active
														</span>
													)}
												</div>
												<p className="truncate text-xs text-muted-foreground">
													{formatWorkspaceLabel(wsPath)}
												</p>
											</div>
											{isActive && (
												<Check className="ml-auto h-4 w-4 text-primary" />
											)}
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
					</Command>
				</div>

				{/* Quick actions */}
				<div className="mb-8 w-full">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{quickActions?.map((action) => {
							return (
								<button
									type="button"
									key={action.id}
									onClick={() => handleQuickAction(action)}
									className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card/50 p-4 text-left transition-all hover:border-primary/30 hover:bg-card"
								>
									<div>
										<p className="text-sm font-medium text-foreground">
											{action.label}
										</p>
										<p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
											{action.description}
										</p>
									</div>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
