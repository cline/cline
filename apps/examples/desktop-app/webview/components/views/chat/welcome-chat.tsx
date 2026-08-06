"use client";

import {
	AgentAurora,
	AgentHeroHeading,
	type AgentQuickAction,
	AgentQuickActions,
} from "@cline/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { desktopClient } from "@/lib/desktop-client";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

const DEFAULT_QUICK_ACTIONS: AgentQuickAction[] = [
	{
		id: "review-changes",
		label: "Review changes",
		description: "Review the current changes and call out anything risky.",
		value: "Review the current changes and call out anything risky.",
	},
	{
		id: "check-build",
		label: "Check for build errors",
		description: "Run the relevant checks and help me fix any failures.",
		value: "Check this project for build errors and help me fix any failures.",
	},
];

export function WelcomeScreen({
	active,
	body,
	composer,
	onStartChat,
	quickActions,
	gitBranch,
	onListGitBranches,
	onSwitchGitBranch,
	executionTarget = "local",
	repoUrl = "",
	cloudBranch = "",
	onExecutionTargetChange = () => undefined,
	onRepoUrlChange = () => undefined,
	onCloudBranchChange = () => undefined,
	cloudAgentsEnabled = false,
}: {
	active: boolean;
	body: ReactNode;
	composer: ReactNode;
	onStartChat: (prompt: string) => void;
	quickActions: AgentQuickAction[];
	gitBranch: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	executionTarget?: "local" | "cloud";
	repoUrl?: string;
	cloudBranch?: string;
	onExecutionTargetChange?: (target: "local" | "cloud") => void;
	onRepoUrlChange?: (repoUrl: string) => void;
	onCloudBranchChange?: (branch: string) => void;
	cloudAgentsEnabled?: boolean;
}) {
	const { user, refreshAccount } = useAccount();
	const [signingIn, setSigningIn] = useState(false);
	const [signInError, setSignInError] = useState<string | null>(null);
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces,
		switchWorkspace,
		pickWorkspaceDirectory,
		selectChat,
	} = useWorkspace();
	const actions =
		quickActions.length > 0 ? quickActions : DEFAULT_QUICK_ACTIONS;

	useEffect(() => {
		if (active && executionTarget === "local") void refreshWorkspaces();
	}, [active, executionTarget, refreshWorkspaces]);

	const signIn = async () => {
		if (signingIn) return;
		setSigningIn(true);
		setSignInError(null);
		try {
			await desktopClient.invoke("run_provider_oauth_login", {
				provider: "cline",
			});
			invalidateProviderCatalogCache();
			await refreshAccount();
		} catch (error) {
			setSignInError(error instanceof Error ? error.message : String(error));
		} finally {
			setSigningIn(false);
		}
	};

	return (
		<div
			className={cn(
				active
					? "relative h-full min-h-0 overflow-hidden bg-background"
					: "contents",
			)}
		>
			{active ? <AgentAurora /> : null}
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
							? "mx-auto flex w-full max-w-240 flex-col px-6 pb-32 pt-[clamp(8rem,26vh,17rem)] max-[720px]:px-4 max-[720px]:pb-20 max-[720px]:pt-16"
							: "contents",
					)}
				>
					{active ? (
						<>
							<AgentHeroHeading />

							<div className="mt-11 flex min-w-0 items-center">
								<WelcomeWorkspaceControls
									cloudBranch={cloudBranch}
									cloudEnabled={cloudAgentsEnabled}
									currentBranch={gitBranch}
									executionTarget={executionTarget}
									onCloudBranchChange={onCloudBranchChange}
									onListGitBranches={onListGitBranches}
									onPickWorkspaceDirectory={pickWorkspaceDirectory}
									onRefreshWorkspaces={refreshWorkspaces}
									onExecutionTargetChange={onExecutionTargetChange}
									onRepoUrlChange={onRepoUrlChange}
									onSignIn={signIn}
									onSelectChat={selectChat}
									onSwitchGitBranch={onSwitchGitBranch}
									onSwitchWorkspace={switchWorkspace}
									repoUrl={repoUrl}
									signedIn={Boolean(user)}
									signingIn={signingIn}
									workspaceRoot={workspaceRoot}
									workspaces={workspaces}
								/>
								{signInError ? (
									<p className="mt-2 text-xs text-destructive">
										Sign in failed: {signInError}
									</p>
								) : null}
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
						<AgentQuickActions
							actions={actions}
							className="mt-11"
							onSelect={(action) => onStartChat(action.value)}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}
