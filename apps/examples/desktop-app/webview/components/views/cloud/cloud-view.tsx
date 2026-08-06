"use client";

import { Cloud, Loader2, Settings2, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/contexts/account-context";
import { useDesktopSettings } from "@/contexts/desktop-settings-context";
import {
	type CloudGithubStatus,
	type CloudModel,
	type CloudRemoteSession,
	createCloudSession,
	deleteCloudSession,
	fetchCloudGithubStatus,
	fetchCloudModels,
	fetchCloudSessions,
	renameCloudSession,
} from "@/lib/cloud-sessions";
import { CloudOnboarding } from "./cloud-onboarding";
import { CloudSessionChat } from "./cloud-session-chat";
import {
	CloudSessionsHome,
	type NewCloudSessionInput,
} from "./cloud-sessions-home";

/**
 * Cloud Sessions surface: gates on the settings toggle and the signed-in
 * account, walks new users through connecting GitHub, then offers the
 * session list / composer and the live session chat.
 */
export function CloudView({
	onOpenAccountSettings,
	onOpenGeneralSettings,
}: {
	onOpenAccountSettings: () => void;
	onOpenGeneralSettings: () => void;
}) {
	const { settings, loaded: settingsLoaded } = useDesktopSettings();
	const { user, activeOrganization } = useAccount();
	const organizationId = activeOrganization?.organizationId;

	const [githubStatus, setGithubStatus] = useState<CloudGithubStatus | null>(
		null,
	);
	const [githubStatusError, setGithubStatusError] = useState<string | null>(
		null,
	);
	const [githubStatusLoading, setGithubStatusLoading] = useState(true);
	const [sessions, setSessions] = useState<CloudRemoteSession[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [sessionsError, setSessionsError] = useState<string | null>(null);
	const [models, setModels] = useState<CloudModel[]>([]);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [openSession, setOpenSession] = useState<CloudRemoteSession | null>(
		null,
	);
	const [pendingInitialPrompt, setPendingInitialPrompt] = useState<
		string | undefined
	>(undefined);
	// Serializes async refreshes so a stale response never wins.
	const refreshTokenRef = useRef(0);

	const refreshGithubStatus = useCallback(async () => {
		const token = ++refreshTokenRef.current;
		setGithubStatusLoading(true);
		setGithubStatusError(null);
		try {
			const status = await fetchCloudGithubStatus(organizationId);
			if (refreshTokenRef.current === token) {
				setGithubStatus(status);
			}
		} catch (error) {
			if (refreshTokenRef.current === token) {
				setGithubStatusError(
					error instanceof Error ? error.message : String(error),
				);
			}
		} finally {
			if (refreshTokenRef.current === token) {
				setGithubStatusLoading(false);
			}
		}
	}, [organizationId]);

	const refreshSessions = useCallback(async () => {
		setSessionsLoading(true);
		setSessionsError(null);
		try {
			const list = await fetchCloudSessions(organizationId);
			setSessions(list);
		} catch (error) {
			setSessionsError(error instanceof Error ? error.message : String(error));
		} finally {
			setSessionsLoading(false);
		}
	}, [organizationId]);

	useEffect(() => {
		if (!settings.cloudSessionsEnabled) {
			return;
		}
		void refreshGithubStatus();
	}, [refreshGithubStatus, settings.cloudSessionsEnabled]);

	const githubConnected = githubStatus?.connected === true;

	useEffect(() => {
		if (!settings.cloudSessionsEnabled || !githubConnected) {
			return;
		}
		void refreshSessions();
		void fetchCloudModels()
			.then(setModels)
			.catch(() => {
				// The composer falls back to the default model id.
			});
	}, [githubConnected, refreshSessions, settings.cloudSessionsEnabled]);

	const handleCreateSession = useCallback(
		async (input: NewCloudSessionInput) => {
			setCreating(true);
			setCreateError(null);
			try {
				const created = await createCloudSession({
					modelId: input.modelId,
					repoUrl: input.repoUrl,
					title: input.title,
					organizationId,
				});
				const session: CloudRemoteSession = {
					id: created.sessionId,
					title: input.title,
					repoUrl: input.repoUrl,
					modelId: input.modelId,
					organizationId: organizationId ?? null,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				};
				setSessions((current) => [session, ...current]);
				setPendingInitialPrompt(input.prompt);
				setOpenSession(session);
			} catch (error) {
				setCreateError(error instanceof Error ? error.message : String(error));
			} finally {
				setCreating(false);
			}
		},
		[organizationId],
	);

	const handleRenameSession = useCallback(
		async (sessionId: string, title: string) => {
			await renameCloudSession(sessionId, title);
			setSessions((current) =>
				current.map((session) =>
					session.id === sessionId ? { ...session, title } : session,
				),
			);
			setOpenSession((current) =>
				current?.id === sessionId ? { ...current, title } : current,
			);
		},
		[],
	);

	const handleDeleteSession = useCallback(async (sessionId: string) => {
		await deleteCloudSession(sessionId);
		setSessions((current) =>
			current.filter((session) => session.id !== sessionId),
		);
		setOpenSession((current) => (current?.id === sessionId ? null : current));
	}, []);

	const handleBackToList = useCallback(() => {
		const closing = openSession;
		setOpenSession(null);
		setPendingInitialPrompt(undefined);
		// Sessions keep streaming into the pooled sidecar connection; drop it
		// when leaving an idle transcript to avoid piling up sockets. A running
		// session stays connected so progress keeps arriving instantly on
		// reopen (the sidecar reconciles duplicates).
		if (closing) {
			void refreshSessions();
		}
	}, [openSession, refreshSessions]);

	// Gate 1: feature toggle.
	if (settingsLoaded && !settings.cloudSessionsEnabled) {
		return (
			<CenteredNotice
				action={
					<Button onClick={onOpenGeneralSettings} type="button">
						<Settings2 className="size-4" />
						Open Settings
					</Button>
				}
				description="Cloud Sessions are turned off. Enable them in Settings → General to run Cline on your repositories in the cloud."
				icon={Cloud}
				title="Cloud Sessions are disabled"
			/>
		);
	}

	// Gate 2: signed-in Cline account.
	if (!user && (githubStatus?.signedOut || githubStatusError)) {
		return (
			<CenteredNotice
				action={
					<Button onClick={onOpenAccountSettings} type="button">
						<UserRound className="size-4" />
						Sign in
					</Button>
				}
				description="Cloud Sessions run on your Cline account. Sign in under Settings → Account, then come back here."
				icon={Cloud}
				title="Sign in to use Cloud Sessions"
			/>
		);
	}

	if (githubStatusLoading && !githubStatus) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
				<Loader2 className="size-5 animate-spin" />
				<p className="text-sm">Checking your cloud setup...</p>
			</div>
		);
	}

	if (githubStatusError && !githubStatus) {
		return (
			<CenteredNotice
				action={
					<Button
						onClick={() => void refreshGithubStatus()}
						type="button"
						variant="outline"
					>
						Try again
					</Button>
				}
				description={githubStatusError}
				icon={Cloud}
				title="Could not reach Cline Cloud"
			/>
		);
	}

	// Gate 3: GitHub connected on the dashboard.
	if (githubStatus && !githubStatus.connected) {
		return (
			<CloudOnboarding
				connectUrl={githubStatus.connectUrl}
				onRefresh={refreshGithubStatus}
				organizationName={activeOrganization?.name}
				refreshing={githubStatusLoading}
			/>
		);
	}

	if (openSession) {
		return (
			<CloudSessionChat
				initialPrompt={pendingInitialPrompt}
				key={openSession.id}
				onBack={handleBackToList}
				onInitialPromptConsumed={() => setPendingInitialPrompt(undefined)}
				session={openSession}
			/>
		);
	}

	return (
		<CloudSessionsHome
			createError={createError}
			creating={creating}
			dashboardUrl={githubStatus?.connectUrl ?? "https://app.cline.bot"}
			models={models}
			onCreateSession={handleCreateSession}
			onDeleteSession={handleDeleteSession}
			onOpenSession={(session) => {
				setPendingInitialPrompt(undefined);
				setOpenSession(session);
			}}
			onRefresh={refreshSessions}
			onRenameSession={handleRenameSession}
			repositories={githubStatus?.repositories ?? []}
			sessions={sessions}
			sessionsError={sessionsError}
			sessionsLoading={sessionsLoading}
		/>
	);
}

function CenteredNotice({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
			<div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
				<Icon className="size-7 text-muted-foreground" />
			</div>
			<div>
				<p className="text-[17px] font-semibold text-foreground">{title}</p>
				<p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}
