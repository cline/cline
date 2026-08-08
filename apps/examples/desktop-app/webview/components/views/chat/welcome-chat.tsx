"use client";

import {
	AgentAurora,
	AgentHeroHeading,
	type AgentQuickAction,
	AgentQuickActions,
} from "@cline/ui";
import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import { useWorkspace } from "@/contexts/workspace-context";
import {
	type CloudBranchListOptions,
	type CloudBranchListResult,
	type CloudRepositoryListResult,
	normalizeCloudRepositoryUrl,
} from "@/lib/cloud-repositories";
import { desktopClient } from "@/lib/desktop-client";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import {
	CloudOnboardingCard,
	type CloudOnboardingVariant,
} from "./cloud-onboarding";
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

const FALLBACK_CONNECT_URL = "https://app.cline.bot/dashboard/integrations";
// The dashboard hand-off happens in the browser, so re-check often enough
// that the panel flips to ready shortly after the user finishes there.
const CLOUD_SETUP_POLL_INTERVAL_MS = 6_000;

type CloudSetupState = {
	status:
		| "unknown"
		| "checking"
		| "ready"
		| "not_connected"
		| "no_repositories"
		| "error";
	connectUrl: string;
	/** Normalized URLs of repositories the account can currently access. */
	repositoryUrls: string[];
};

export function WelcomeScreen({
	active,
	body,
	composer,
	notice,
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
	/** Rendered above the composer on the welcome state (e.g. setup notice). */
	notice?: ReactNode;
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
	const [cloudSetup, setCloudSetup] = useState<CloudSetupState>({
		status: "unknown",
		connectUrl: FALLBACK_CONNECT_URL,
		repositoryUrls: [],
	});
	const [cloudSetupChecking, setCloudSetupChecking] = useState(false);
	const cloudSetupRequestRef = useRef(0);
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
	const listCloudRepositories = useCallback(
		() =>
			desktopClient.invoke<CloudRepositoryListResult>(
				"list_cloud_repositories",
				{},
			),
		[],
	);
	const listCloudBranches = useCallback(
		async (repositoryId: number, options: CloudBranchListOptions = {}) => {
			const result = await desktopClient.invoke<{
				available?: boolean;
				branches?: string[];
				nextToken?: string;
			}>("list_cloud_branches", { repositoryId, ...options });
			return {
				available: result.available !== false,
				branches: Array.isArray(result.branches) ? result.branches : [],
				nextToken:
					typeof result.nextToken === "string" ? result.nextToken : undefined,
			} satisfies CloudBranchListResult;
		},
		[],
	);
	const openExternalUrl = useCallback(async (url: string) => {
		await desktopClient.invoke("open_external_url", { url });
	}, []);

	const cloudModeActive =
		active && cloudAgentsEnabled && executionTarget === "cloud";
	const signedIn = Boolean(user);
	const accountUserId = user?.id ?? null;
	// Read by the poll interval without making the state updater impure or
	// re-subscribing the effect on every status change.
	const cloudSetupStatusRef = useRef(cloudSetup.status);
	cloudSetupStatusRef.current = cloudSetup.status;

	const checkCloudSetup = useCallback(async () => {
		const requestId = ++cloudSetupRequestRef.current;
		setCloudSetupChecking(true);
		try {
			const result = await listCloudRepositories();
			if (cloudSetupRequestRef.current !== requestId) return;
			setCloudSetup({
				status:
					result.connected === false
						? "not_connected"
						: result.repositories.length === 0
							? "no_repositories"
							: "ready",
				connectUrl: result.connectUrl?.trim() || FALLBACK_CONNECT_URL,
				repositoryUrls: result.repositories.map((repository) =>
					normalizeCloudRepositoryUrl(repository.url),
				),
			});
		} catch {
			if (cloudSetupRequestRef.current !== requestId) return;
			setCloudSetup((prev) => ({ ...prev, status: "error" }));
		} finally {
			if (cloudSetupRequestRef.current === requestId) {
				setCloudSetupChecking(false);
			}
		}
	}, [listCloudRepositories]);

	// Check GitHub connectivity whenever the cloud composer becomes relevant
	// or the signed-in account changes, and keep watching while onboarding is
	// on screen: the connect flow finishes in the browser, so the panel must
	// notice on its own.
	useEffect(() => {
		void accountUserId;
		if (!cloudModeActive || !signedIn) return;
		setCloudSetup((prev) =>
			prev.status === "unknown" ? { ...prev, status: "checking" } : prev,
		);
		void checkCloudSetup();
		const handleFocus = () => void checkCloudSetup();
		window.addEventListener("focus", handleFocus);
		const interval = window.setInterval(() => {
			const status = cloudSetupStatusRef.current;
			if (status === "not_connected" || status === "no_repositories") {
				void checkCloudSetup();
			}
		}, CLOUD_SETUP_POLL_INTERVAL_MS);
		return () => {
			window.removeEventListener("focus", handleFocus);
			window.clearInterval(interval);
		};
	}, [accountUserId, checkCloudSetup, cloudModeActive, signedIn]);

	useEffect(() => {
		if (active && executionTarget === "local") void refreshWorkspaces();
	}, [active, executionTarget, refreshWorkspaces]);

	// A previously selected repository can disappear from the account's reach
	// (GitHub App access revoked, account/org switched). Clear the stale
	// selection so the "Repository required" gate re-engages instead of
	// letting the send fail server-side after the fact.
	useEffect(() => {
		if (!cloudModeActive || cloudSetup.status === "unknown") return;
		if (cloudSetup.status === "error" || cloudSetup.status === "checking") {
			return;
		}
		const normalized = normalizeCloudRepositoryUrl(repoUrl);
		if (!normalized) return;
		if (!cloudSetup.repositoryUrls.includes(normalized)) {
			onRepoUrlChange("");
			onCloudBranchChange("");
		}
	}, [
		cloudModeActive,
		cloudSetup,
		onCloudBranchChange,
		onRepoUrlChange,
		repoUrl,
	]);

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

	const cloudOnboardingVariant: CloudOnboardingVariant | null = !cloudModeActive
		? null
		: !signedIn
			? "signed_out"
			: cloudSetup.status === "not_connected"
				? "not_connected"
				: cloudSetup.status === "no_repositories"
					? "no_repositories"
					: cloudSetup.status === "error"
						? "error"
						: null;
	const showCloudOnboarding = cloudOnboardingVariant !== null;

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
						<div className="cline-view-enter">
							<AgentHeroHeading />

							<div className="mt-11 flex min-w-0 items-center">
								<WelcomeWorkspaceControls
									cloudBranch={cloudBranch}
									cloudControlsHidden={showCloudOnboarding}
									cloudEnabled={cloudAgentsEnabled}
									currentBranch={gitBranch}
									executionTarget={executionTarget}
									onCloudBranchChange={onCloudBranchChange}
									onListCloudBranches={listCloudBranches}
									onListCloudRepositories={listCloudRepositories}
									onListGitBranches={onListGitBranches}
									onOpenExternalUrl={openExternalUrl}
									onPickWorkspaceDirectory={pickWorkspaceDirectory}
									onRefreshWorkspaces={refreshWorkspaces}
									onExecutionTargetChange={onExecutionTargetChange}
									onRepoUrlChange={onRepoUrlChange}
									onSignIn={signIn}
									onSelectChat={selectChat}
									onSwitchGitBranch={onSwitchGitBranch}
									onSwitchWorkspace={switchWorkspace}
									repoUrl={repoUrl}
									signedIn={signedIn}
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
						</div>
					) : null}

					<div
						className={
							active
								? "hidden"
								: "cline-view-enter h-full min-h-0 overflow-hidden"
						}
						key="conversation-body"
					>
						{body}
					</div>

					{active && notice && !showCloudOnboarding ? notice : null}

					{active && showCloudOnboarding ? (
						<div className="mt-4 w-full">
							<CloudOnboardingCard
								checking={cloudSetupChecking}
								onConnect={() => void openExternalUrl(cloudSetup.connectUrl)}
								onRefresh={() => void checkCloudSetup()}
								onSignIn={() => void signIn()}
								signingIn={signingIn}
								variant={cloudOnboardingVariant}
							/>
						</div>
					) : null}

					<div
						className={cn(
							active ? "mt-4 w-full" : "z-20 shrink-0",
							active && showCloudOnboarding && "hidden",
						)}
						key="persistent-composer"
					>
						{composer}
					</div>

					{active && cloudModeActive && !showCloudOnboarding ? (
						<p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
							<Cloud aria-hidden="true" className="size-3 shrink-0" />
							Cloud sessions run on a secure sandbox, work on a branch, and keep
							going even when you close the app.
						</p>
					) : null}

					{active && !showCloudOnboarding ? (
						<AgentQuickActions
							actions={actions}
							className="cline-view-enter mt-11"
							onSelect={(action) => onStartChat(action.value)}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}
