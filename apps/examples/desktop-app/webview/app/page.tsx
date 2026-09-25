"use client";

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { AttachmentDropZone } from "@cline/ui";
import { Loader2, LoaderCircle } from "lucide-react";
import dynamic from "next/dynamic";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { AgentHeader } from "@/components/agent-header";
import { AgentSidebar } from "@/components/agent-sidebar";
import { HubUpdateRequiredDialog } from "@/components/hub-update-required-dialog";
import { SessionCommandBar } from "@/components/session-command-bar";
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
import {
	Sidebar,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { ToastAction } from "@/components/ui/toast";
import { ChatInputBar } from "@/components/views/chat/chat-input-bar";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import {
	CloudHandoffProgress,
	CloudHandoffReceipt,
	CloudHandoffRecoveryNotice,
} from "@/components/views/chat/cloud-handoff";
import { EnvironmentSelector } from "@/components/views/chat/environment-selector";
import { RemoteDirectoryPicker } from "@/components/views/chat/remote-directory-picker";
import { WelcomeScreen } from "@/components/views/chat/welcome-chat";
import { WelcomeSetupNotice } from "@/components/views/chat/welcome-setup-notice";
import type { OnboardingStep } from "@/components/views/onboarding/onboarding-view";
import { ExportDiagnosticsDialog } from "@/components/views/settings/export-diagnostics-dialog";
import type { SettingsSection } from "@/components/views/settings/sections";
import {
	WindowTitleBar,
	WindowTitleBarContent,
	WindowTitleBarProvider,
} from "@/components/window-title-bar";
import { AccountProvider, useAccount } from "@/contexts/account-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import {
	serializeAttachments,
	toChatMessageImages,
} from "@/hooks/chat-session/attachments";
import type {
	ProcessContext,
	SerializedAttachments,
} from "@/hooks/chat-session/types";
import { checkForUpdateAndNotify, useAppUpdate } from "@/hooks/use-app-update";
import { useChatSession } from "@/hooks/use-chat-session";
import { usePendingAttachments } from "@/hooks/use-pending-attachments";
import { useSessionAgents } from "@/hooks/use-session-agents";
import {
	resolveLiveHistorySession,
	useSessionHistory,
} from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import { applyAppZoomAction, syncAppFontSize } from "@/lib/app-font-size";
import { syncAppIcon } from "@/lib/app-icon";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import { openPersonalGitHubInstallUrl } from "@/lib/cline-integrations";
import {
	HANDOFF_PROGRESS_LABELS,
	type HandoffPreflight,
	type HandoffProgressPhase,
	type HandoffResult,
	isExpectedHandoffSourceActive,
	parseHandoffCommand,
	readHandoffReceipt,
	readPendingHandoffRecovery,
	validateHandoffAttachments,
} from "@/lib/cloud-handoff";
import {
	createHandoffLifecycle,
	type HandoffLifecycle,
} from "@/lib/cloud-handoff-lifecycle";
import {
	appendPendingHandoffPrompt,
	type CloudHandoffUiAction,
	type CloudHandoffUiState,
	cloudHandoffUiReducer,
	hasLivePendingHandoff,
	matchingUserPromptCount,
	type PendingHandoffPrompt,
	pendingHandoffPromptCaughtUp,
	resolveHandoffReceipt,
} from "@/lib/cloud-handoff-ui-state";
import { cloudRepositoryLabel } from "@/lib/cloud-repositories";
import {
	humanizeCloudSessionError,
	parseCloudSessionError,
} from "@/lib/cloud-session-error";
import {
	createDesktopAppState,
	type DesktopAppLocation,
	type DesktopAppView,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { watchDesktopNotifications } from "@/lib/desktop-notifications";
import {
	subscribeToDesktopActions,
	watchDesktopTrayStatus,
} from "@/lib/desktop-tray";
import { syncDesktopWindowTitle } from "@/lib/desktop-window-title";
import {
	cloudImageAttachmentError,
	imageAttachmentMediaType,
	isSupportedImageAttachment,
	isUnsupportedImageAttachment,
} from "@/lib/image-attachments";
import { createLatestSuccessfulRequestGate } from "@/lib/latest-successful-request";
import {
	hasCompletedOnboarding,
	markOnboardingCompleted,
	ONBOARDING_RESET_EVENT,
} from "@/lib/onboarding";
import { requestPromptInputFocus } from "@/lib/prompt-input-focus";
import { isProviderConnected } from "@/lib/provider-connection";
import {
	fetchProviderCatalog,
	readProviderCatalogSnapshot,
	subscribeToProviderCatalogInvalidation,
	writeProviderCatalogSnapshot,
} from "@/lib/provider-model-catalog";
import type {
	RemoteEnvironmentConnectResult,
	RemoteEnvironmentListResult,
	RemoteEnvironmentProfile,
} from "@/lib/remote-environments";
import {
	buildSessionAgentActivity,
	mergeAgentActivity,
} from "@/lib/session-agents";
import {
	getSessionMetadataTitle,
	type SessionHistoryItem,
	type SessionMetadata,
} from "@/lib/session-history";
import { eventEnvironmentId, sessionKey } from "@/lib/session-identity";
import { readImportedFromTool } from "@/lib/session-import";
import { resolveSessionHeaderStatus } from "@/lib/session-status";
import { syncHubAccent, syncHubTheme, watchSystemHubTheme } from "@/lib/theme";
import {
	readWorkInFromWindow,
	startsNewThread,
	TASK_WORKTREE_DELETE_WARNING,
	type WorkIn,
	writeWorkInToWindow,
} from "@/lib/work-in-selection";
import {
	type RemoteWorkspaceEnvironment,
	remoteWorkspaceEnvironmentFromContext,
} from "@/lib/workspace-environment";
import {
	filterWorkspacePaths,
	isTaskWorktreePath,
	LOCAL_WORKSPACE_ENVIRONMENT_ID,
	mergeWorkspacePaths,
	normalizeWorkspacePath,
	readWorkspaceSelectionFromWindow,
	workspacePathsFromSessions,
	writeWorkspaceSelectionToWindow,
} from "@/lib/workspace-paths";

// Lazily loaded views: none of these are needed for the first paint of the
// chat shell, so keeping them out of the entry chunk shortens app startup.
// Each fallback paints the same background as the loaded view so switching
// never flashes.
const viewLoading = () => (
	<div className="flex h-full flex-1 items-center justify-center bg-background">
		<Loader2 className="size-5 animate-spin text-muted-foreground" />
	</div>
);

const SettingsView = dynamic(
	() =>
		import("@/components/views/settings/settings-view").then(
			(module) => module.SettingsView,
		),
	{ loading: viewLoading, ssr: false },
);

const SessionsView = dynamic(
	() =>
		import("@/components/views/sessions/sessions-view").then(
			(module) => module.SessionsView,
		),
	{ loading: viewLoading, ssr: false },
);

const OnboardingView = dynamic(
	() =>
		import("@/components/views/onboarding/onboarding-view").then(
			(module) => module.OnboardingView,
		),
	{
		loading: () => <div className="h-full w-full bg-background" />,
		ssr: false,
	},
);

const DiffView = dynamic(
	() =>
		import("@/components/views/chat/diff-view").then(
			(module) => module.DiffView,
		),
	{ loading: viewLoading, ssr: false },
);

function makeThreadId(): string {
	return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const GIT_BRANCH_REFRESH_INTERVAL_MS = 5_000;

type AppLocation = DesktopAppLocation<SettingsSection>;

const LONG_PROVISIONING_THRESHOLD_MS = 60_000;

type CloudProvisioningPhase =
	| "provisioning"
	| "cloning_repo"
	| "agent_starting"
	| "ready"
	| "failed";

function readCloudProvisioningPhase(
	value: unknown,
): CloudProvisioningPhase | undefined {
	return value === "provisioning" ||
		value === "cloning_repo" ||
		value === "agent_starting" ||
		value === "ready" ||
		value === "failed"
		? value
		: undefined;
}

// create() can spend one 610s window on the original POST and another on
// timeout recovery. Leave room for auth, Hub attach, seeding, and verification
// without waiting forever for a lost transport response.
const HANDOFF_INVOKE_TIMEOUT_MS = 25 * 60_000;

function useCloudProvisioningPhase(
	repoUrl: string | undefined,
	active: boolean,
	phase: CloudProvisioningPhase | undefined,
	startedAt: string | undefined,
): string {
	const repoLabel = cloudRepositoryLabel(repoUrl ?? "");
	const [longRunning, setLongRunning] = useState(false);
	useEffect(() => {
		if (!active) {
			setLongRunning(false);
			return;
		}
		const parsedStartedAt = Date.parse(startedAt ?? "");
		const elapsed = Number.isFinite(parsedStartedAt)
			? Math.max(0, Date.now() - parsedStartedAt)
			: 0;
		if (elapsed >= LONG_PROVISIONING_THRESHOLD_MS) {
			setLongRunning(true);
			return;
		}
		setLongRunning(false);
		const timeout = window.setTimeout(
			() => setLongRunning(true),
			LONG_PROVISIONING_THRESHOLD_MS - elapsed,
		);
		return () => window.clearTimeout(timeout);
	}, [active, startedAt]);
	const label =
		phase === "cloning_repo"
			? repoLabel
				? `Cloning ${repoLabel}`
				: "Cloning your repository"
			: phase === "agent_starting"
				? "Starting the agent"
				: "Starting your workspace";
	return longRunning
		? `${label}... This may take several minutes.`
		: `${label}...`;
}

function CloudProvisioningPane({ phase }: { phase: string }) {
	return (
		<div className="px-6 py-6">
			<div
				aria-live="polite"
				className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
			>
				<LoaderCircle className="h-4 w-4 animate-spin" />
				<span className="cline-chat-streaming-title">{phase}</span>
			</div>
		</div>
	);
}

function toThreadTitle(options: { title?: string; prompt?: string }): string {
	const preferredTitle = options.title?.trim();
	if (preferredTitle) {
		return preferredTitle.slice(0, 70);
	}
	const line = options.prompt?.trim().split("\n")[0]?.trim();
	if (line) return line.slice(0, 70);
	return "New session";
}

export default function Home() {
	const [initialThreadId] = useState(makeThreadId);
	const [appState, dispatchApp] = useReducer(
		desktopAppReducer<SettingsSection>,
		initialThreadId,
		(threadId) =>
			createDesktopAppState(
				threadId,
				"General",
				LOCAL_WORKSPACE_ENVIRONMENT_ID,
			),
	);
	const [handoffUiState, dispatchHandoffUi] = useReducer(
		cloudHandoffUiReducer,
		{},
	);
	// Starts false on both server and first client render (hydration-safe);
	// the effect below reads the persisted state right after mount.
	const [showOnboarding, setShowOnboarding] = useState(false);
	const [commandBarOpen, setCommandBarOpen] = useState(false);
	const [exportDiagnosticsOpen, setExportDiagnosticsOpen] = useState(false);
	// Shared by the sidebar search icon and the Cmd/Ctrl+P shortcut.
	const handleOpenCommandBar = useCallback(() => setCommandBarOpen(true), []);
	// "welcome" for the full first-run flow; "connect" when re-entered from
	// the in-app "connect a model" notice, which should land directly on the
	// provider setup step.
	const [onboardingInitialStep, setOnboardingInitialStep] =
		useState<OnboardingStep>("welcome");
	const environmentSelectionRevision = useRef(0);
	const [activeRemoteEnvironment, setActiveRemoteEnvironment] =
		useState<RemoteWorkspaceEnvironment | null>(null);
	const [remoteEnvironmentProfiles, setRemoteEnvironmentProfiles] = useState<
		RemoteEnvironmentProfile[]
	>([]);
	const [
		remoteEnvironmentProfilesLoading,
		setRemoteEnvironmentProfilesLoading,
	] = useState(true);
	const [remoteDirectoryPicker, setRemoteDirectoryPicker] =
		useState<RemoteWorkspaceEnvironment | null>(null);
	const remoteDirectoryPickerResolverRef = useRef<
		((path: string | null) => void) | null
	>(null);
	const selectLocalDraftWhenChatVisibleRef = useRef(false);
	const { navigation, threads } = appState;
	const { activeThreadId, settingsSection, view } = navigation.current;
	const activeEnvironmentId =
		activeRemoteEnvironment?.id ?? LOCAL_WORKSPACE_ENVIRONMENT_ID;

	const navigate = useCallback((destination: AppLocation) => {
		dispatchApp({ type: "navigate", destination });
	}, []);
	const navigateWith = useCallback(
		(destination: Partial<AppLocation>) => {
			navigate({ ...navigation.current, ...destination });
		},
		[navigate, navigation.current],
	);
	const handleNavigateBack = useCallback(() => {
		dispatchApp({ type: "back" });
	}, []);
	const handleNavigateForward = useCallback(() => {
		dispatchApp({ type: "forward" });
	}, []);

	useAppUpdate();

	useEffect(() => {
		setShowOnboarding(!hasCompletedOnboarding());
		const handleReset = () => setShowOnboarding(true);
		window.addEventListener(ONBOARDING_RESET_EVENT, handleReset);
		return () =>
			window.removeEventListener(ONBOARDING_RESET_EVENT, handleReset);
	}, []);

	useEffect(() => {
		syncHubTheme();
		syncHubAccent();
		syncAppFontSize();
		return watchSystemHubTheme();
	}, []);

	useEffect(() => {
		// The native app icon reverts to the bundled icon every launch; re-apply
		// the user's choice once the shell is up.
		void syncAppIcon();
	}, []);

	useEffect(() => {
		void syncDesktopWindowTitle();
	}, []);

	useEffect(() => {
		let cancelled = false;
		const revision = environmentSelectionRevision.current;
		desktopClient
			.invoke<ProcessContext>("get_process_context")
			.then((context) => {
				if (!cancelled && revision === environmentSelectionRevision.current) {
					const remoteEnvironment =
						remoteWorkspaceEnvironmentFromContext(context);
					setActiveRemoteEnvironment(remoteEnvironment);
					if (remoteEnvironment) {
						dispatchApp({
							type: "select-environment-draft",
							threadId: makeThreadId(),
							environmentId: remoteEnvironment.id,
						});
					}
				}
			})
			.catch(() => {
				// The chat bootstrap reports backend availability separately.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (view !== "chat") return;
		let revision = 0;
		const refresh = () => {
			const requestRevision = ++revision;
			setRemoteEnvironmentProfilesLoading(true);
			void desktopClient
				.invoke<RemoteEnvironmentListResult>("list_remote_environments")
				.then((result) => {
					if (requestRevision === revision)
						setRemoteEnvironmentProfiles(result.profiles);
				})
				.catch(() => {
					// The Settings > Remote surface owns profile-management errors.
				})
				.finally(() => {
					if (requestRevision === revision)
						setRemoteEnvironmentProfilesLoading(false);
				});
		};
		const unsubscribe = desktopClient.subscribe(
			"remote_environment_profiles_changed",
			refresh,
		);
		refresh();
		return () => {
			++revision;
			unsubscribe();
		};
	}, [view]);

	useEffect(
		() => () => {
			remoteDirectoryPickerResolverRef.current?.(null);
			remoteDirectoryPickerResolverRef.current = null;
		},
		[],
	);

	useEffect(() => watchDesktopTrayStatus(), []);
	useEffect(() => watchDesktopNotifications(), []);

	const createThreadForEnvironment = useCallback((environmentId: string) => {
		dispatchApp({
			type: "new-thread",
			threadId: makeThreadId(),
			environmentId,
		});
		requestPromptInputFocus();
	}, []);
	const handleNewThread = useCallback(() => {
		createThreadForEnvironment(activeEnvironmentId);
	}, [activeEnvironmentId, createThreadForEnvironment]);
	const selectEnvironmentDraft = useCallback((environmentId: string) => {
		dispatchApp({
			type: "select-environment-draft",
			environmentId,
			threadId: makeThreadId(),
		});
	}, []);
	const handleSelectEnvironment = useCallback(
		async (environmentId: string) => {
			environmentSelectionRevision.current += 1;
			if (environmentId === activeRemoteEnvironment?.id) {
				// Already connected (e.g. after navigating Back to a local draft);
				// reconnecting would tear down and rebuild the remote runtime.
				selectEnvironmentDraft(environmentId);
				return;
			}
			try {
				if (environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID) {
					if (activeRemoteEnvironment) {
						await desktopClient.invoke(
							"disconnect_remote_environment",
							{ id: activeRemoteEnvironment.id },
							{ timeoutMs: null },
						);
					}
					setActiveRemoteEnvironment(null);
					selectEnvironmentDraft(LOCAL_WORKSPACE_ENVIRONMENT_ID);
					return;
				}

				const result =
					await desktopClient.invoke<RemoteEnvironmentConnectResult>(
						"connect_remote_environment",
						{ id: environmentId },
						{ timeoutMs: null },
					);
				const connectedEnvironmentId = result.environmentId.trim();
				const homeDir = result.homeDir.trim() || result.workspaceRoot.trim();
				if (
					connectedEnvironmentId !== environmentId ||
					result.activeEnvironmentId !== connectedEnvironmentId ||
					result.activeProfileId !== connectedEnvironmentId ||
					!homeDir
				) {
					throw new Error(
						"The SSH host connected without a valid environment identity or home directory.",
					);
				}

				const storedWorkspace = readWorkspaceSelectionFromWindow(
					connectedEnvironmentId,
				);
				if (!storedWorkspace.lastWorkspace) {
					writeWorkspaceSelectionToWindow(connectedEnvironmentId, {
						...storedWorkspace,
						lastWorkspace: homeDir,
					});
				}
				setActiveRemoteEnvironment({
					id: connectedEnvironmentId,
					homeDir,
				});
				selectEnvironmentDraft(connectedEnvironmentId);
			} catch (error) {
				toast({
					title:
						environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID
							? "Unable to switch to Local"
							: "Unable to connect to SSH host",
					description: error instanceof Error ? error.message : String(error),
					variant: "destructive",
				});
				throw error;
			}
		},
		[activeRemoteEnvironment, selectEnvironmentDraft],
	);
	const pickRemoteWorkspaceDirectory = useCallback(
		(environment: RemoteWorkspaceEnvironment): Promise<string | null> => {
			remoteDirectoryPickerResolverRef.current?.(null);
			return new Promise((resolve) => {
				remoteDirectoryPickerResolverRef.current = resolve;
				setRemoteDirectoryPicker(environment);
			});
		},
		[],
	);
	const completeRemoteDirectoryPicker = useCallback((path: string | null) => {
		const resolve = remoteDirectoryPickerResolverRef.current;
		remoteDirectoryPickerResolverRef.current = null;
		setRemoteDirectoryPicker(null);
		resolve?.(path);
	}, []);

	useEffect(
		() =>
			desktopClient.subscribe("remote_environment_changed", (payload) => {
				if (!payload || typeof payload !== "object") return;
				const event = payload as {
					status?: unknown;
					environmentId?: unknown;
					homeDir?: unknown;
					workspaceRoot?: unknown;
				};
				if (
					event.status === "connected" &&
					typeof event.environmentId === "string" &&
					typeof event.homeDir === "string"
				) {
					environmentSelectionRevision.current += 1;
					selectLocalDraftWhenChatVisibleRef.current = false;
					setActiveRemoteEnvironment({
						id: event.environmentId,
						homeDir: event.homeDir,
					});
				}
				if (event.status === "disconnected") {
					environmentSelectionRevision.current += 1;
					completeRemoteDirectoryPicker(null);
					setActiveRemoteEnvironment(null);
					if (view === "chat") {
						selectEnvironmentDraft(LOCAL_WORKSPACE_ENVIRONMENT_ID);
					} else {
						selectLocalDraftWhenChatVisibleRef.current = true;
					}
				}
			}),
		[completeRemoteDirectoryPicker, selectEnvironmentDraft, view],
	);

	useEffect(() => {
		if (view !== "chat" || !selectLocalDraftWhenChatVisibleRef.current) {
			return;
		}
		selectLocalDraftWhenChatVisibleRef.current = false;
		selectEnvironmentDraft(LOCAL_WORKSPACE_ENVIRONMENT_ID);
	}, [selectEnvironmentDraft, view]);

	const completeOnboarding = useCallback(() => {
		markOnboardingCompleted();
		setShowOnboarding(false);
		setOnboardingInitialStep("welcome");
		// A fresh thread remounts the chat pane so it picks up credentials and
		// the provider/model selection configured during onboarding.
		handleNewThread();
	}, [handleNewThread]);

	const handleOpenSetup = useCallback(() => {
		setOnboardingInitialStep("connect");
		setShowOnboarding(true);
	}, []);

	const handleOpenSession = useCallback(
		(
			session: SessionHistoryItem,
			initialPromptDraft?: string,
			initialAttachments?: File[],
		) => {
			dispatchApp({
				type: "open-session",
				session,
				environmentId: session.environmentId,
				initialPromptDraft,
				initialAttachments,
			});
		},
		[],
	);

	const handleDeleteSession = useCallback(
		(
			deletedSessionId: string,
			deletedThreadId?: string,
			environmentId = LOCAL_WORKSPACE_ENVIRONMENT_ID,
		) => {
			dispatchApp({
				type: "delete-session",
				environmentId,
				deletedSessionId,
				deletedThreadId,
				fallbackThreadId: makeThreadId(),
				fallbackEnvironmentId: activeEnvironmentId,
			});
		},
		[activeEnvironmentId],
	);

	const handleUpdateSessionMetadata = useCallback(
		(
			sessionId: string,
			metadata: SessionMetadata,
			environmentId = LOCAL_WORKSPACE_ENVIRONMENT_ID,
		) => {
			dispatchApp({
				type: "update-session-metadata",
				sessionId,
				metadata,
				environmentId,
			});
		},
		[],
	);

	useEffect(() => {
		return desktopClient.subscribe("session_deleted", (payload) => {
			if (!payload || typeof payload !== "object") {
				return;
			}
			const sessionId =
				typeof (payload as { sessionId?: unknown }).sessionId === "string"
					? (payload as { sessionId: string }).sessionId.trim()
					: "";
			if (!sessionId) {
				return;
			}
			handleDeleteSession(sessionId, undefined, eventEnvironmentId(payload));
		});
	}, [handleDeleteSession]);

	const activeHistorySessionIdentity = threads.find(
		(thread) => thread.id === activeThreadId,
	)?.historySession;
	const activeHistorySessionId = activeHistorySessionIdentity
		? sessionKey(activeHistorySessionIdentity)
		: null;
	const activeThread =
		threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
	const activeLocationRef = useRef({ activeThreadId, view });
	activeLocationRef.current = { activeThreadId, view };
	const handleHome = useCallback(() => {
		if (activeThread?.historySession || activeThread?.hasStarted) {
			handleNewThread();
			return;
		}
		navigateWith({ view: "chat" });
		requestPromptInputFocus();
	}, [activeThread, handleNewThread, navigateWith]);
	const handleViewChange = useCallback(
		(nextView: DesktopAppView) => {
			navigateWith({ view: nextView });
		},
		[navigateWith],
	);
	// The sidebar's New row reads as selected while the fresh, not-yet-started
	// task page is showing; once the task starts the session row takes over.
	const newTaskActive =
		view === "chat" &&
		activeThread !== undefined &&
		!activeThread.hasStarted &&
		!activeThread.historySession;
	const handleSettingsSectionChange = useCallback(
		(section: SettingsSection) => {
			navigateWith({ settingsSection: section, view: "settings" });
		},
		[navigateWith],
	);
	// Standard app shortcuts: Cmd/Ctrl+P for session search, Cmd/Ctrl+N for a
	// new session, and Cmd/Ctrl+, for settings.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (showOnboarding) {
				return;
			}
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
				return;
			}
			if (event.key === "n" || event.key === "N") {
				event.preventDefault();
				handleNewThread();
			} else if (event.key === "p" || event.key === "P") {
				event.preventDefault();
				setCommandBarOpen((current) => !current);
			} else if (event.key === ",") {
				event.preventDefault();
				handleViewChange("settings");
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleNewThread, handleViewChange, showOnboarding]);
	const handleThreadStarted = useCallback(
		(threadId: string, sessionId?: string) => {
			dispatchApp({ type: "thread-started", threadId, sessionId });
		},
		[],
	);
	const handleInitialPromptDraftConsumed = useCallback((threadId: string) => {
		dispatchApp({ type: "consume-initial-prompt-draft", threadId });
	}, []);
	const sessionHistory = useSessionHistory({
		activeSessionId: activeHistorySessionId,
		onDeleteSession: (sessionId, environmentId) =>
			handleDeleteSession(sessionId, undefined, environmentId),
		onOpenSession: handleOpenSession,
		onUpdateSessionMetadata: handleUpdateSessionMetadata,
	});
	const activeHistorySession = resolveLiveHistorySession(
		activeThread?.historySession,
		sessionHistory.sessions,
	);
	const sessionHistoryRef = useRef(sessionHistory.sessions);
	useEffect(() => {
		sessionHistoryRef.current = sessionHistory.sessions;
	}, [sessionHistory.sessions]);
	const handleOpenSessionById = useCallback(
		async (
			sessionId: string,
			optionsOrEnvironment:
				| string
				| {
						environmentId?: string;
						silent?: boolean;
						initialPromptDraft?: string;
						initialAttachments?: File[];
						expectedActiveThreadId?: string;
				  } = {},
		): Promise<boolean> => {
			const options =
				typeof optionsOrEnvironment === "string"
					? { environmentId: optionsOrEnvironment }
					: optionsOrEnvironment;
			const environmentId = options.environmentId;
			if (
				!isExpectedHandoffSourceActive(
					options.expectedActiveThreadId,
					activeLocationRef.current.activeThreadId,
					activeLocationRef.current.view,
				)
			) {
				return false;
			}
			const cachedSession = sessionHistoryRef.current.find(
				(session) =>
					session.sessionId === sessionId &&
					session.environmentId ===
						(environmentId ?? LOCAL_WORKSPACE_ENVIRONMENT_ID),
			);
			if (cachedSession) {
				handleOpenSession(
					cachedSession,
					options.initialPromptDraft,
					options.initialAttachments,
				);
				return true;
			}
			try {
				const session = await desktopClient.invoke<SessionHistoryItem | null>(
					"get_discovered_session",
					{
						environmentId: environmentId ?? LOCAL_WORKSPACE_ENVIRONMENT_ID,
						sessionId: sessionId,
					},
				);
				if (!session) {
					throw new Error("The session for this run is no longer available.");
				}
				if (
					!isExpectedHandoffSourceActive(
						options.expectedActiveThreadId,
						activeLocationRef.current.activeThreadId,
						activeLocationRef.current.view,
					)
				) {
					return false;
				}
				if (
					environmentId !== undefined &&
					session.environmentId !== environmentId
				) {
					throw new Error(
						`The session belongs to environment ${session.environmentId}, not ${environmentId}.`,
					);
				}
				handleOpenSession(
					session,
					options.initialPromptDraft,
					options.initialAttachments,
				);
				return true;
			} catch (error) {
				if (!options.silent) {
					toast({
						title: "Unable to open run",
						description: humanizeCloudSessionError(
							error instanceof Error ? error.message : String(error),
						),
						variant: "destructive",
					});
				}
				return false;
			}
		},
		[handleOpenSession],
	);
	// Keep recovery state across pane changes while using the latest open-session binding.
	const openHandoffSessionRef = useRef(handleOpenSessionById);
	openHandoffSessionRef.current = handleOpenSessionById;
	const handoffLifecycleRef = useRef<HandoffLifecycle | null>(null);
	if (handoffLifecycleRef.current === null) {
		handoffLifecycleRef.current = createHandoffLifecycle({
			dispatch: dispatchHandoffUi,
			toast: ({ connectUrl, ...toastFields }) =>
				toast({
					...toastFields,
					action: connectUrl ? (
						<ToastAction
							altText="Connect GitHub"
							onClick={() => void openExternalUrl(connectUrl)}
						>
							Connect GitHub
						</ToastAction>
					) : undefined,
				}),
			openSession: (sessionId, options) =>
				openHandoffSessionRef.current(sessionId, options),
			openExternal: openExternalUrl,
		});
	}
	const handoffLifecycle = handoffLifecycleRef.current;
	useEffect(
		() =>
			desktopClient.subscribe("cloud_handoff_progress", (payload) => {
				if (!payload || typeof payload !== "object") return;
				const progress = payload as {
					sourceSessionId?: string;
					handoffAttemptId?: string;
					phase?: HandoffProgressPhase;
					message?: string;
					dashboardUrl?: string;
					sessionId?: string;
					destination?: "in_app" | "external";
					warning?: string;
					warningKind?: "unqueued" | "unconfirmed";
					undeliveredCommand?: string;
				};
				if (
					!progress.sourceSessionId?.trim() ||
					!progress.phase ||
					!(progress.phase in HANDOFF_PROGRESS_LABELS)
				) {
					return;
				}
				void handoffLifecycle.onEvent({
					sourceSessionId: progress.sourceSessionId,
					handoffAttemptId: progress.handoffAttemptId,
					phase: progress.phase,
					message: progress.message,
					dashboardUrl: progress.dashboardUrl,
					sessionId: progress.sessionId,
					destination: progress.destination,
					warning: progress.warning,
					warningKind: progress.warningKind,
					undeliveredCommand: progress.undeliveredCommand,
				});
			}),
		[handoffLifecycle],
	);
	useEffect(
		() =>
			subscribeToDesktopActions((action) => {
				switch (action.type) {
					case "new-session":
						handleNewThread();
						break;
					case "open-settings":
						handleViewChange("settings");
						break;
					case "open-session":
						void handleOpenSessionById(action.sessionId);
						break;
					case "export-diagnostics":
						setExportDiagnosticsOpen(true);
						break;
					case "check-for-updates":
						void checkForUpdateAndNotify();
						break;
					case "zoom-in":
					case "zoom-out":
					case "zoom-reset":
						applyAppZoomAction(action.type);
						break;
				}
			}),
		[handleNewThread, handleOpenSessionById, handleViewChange],
	);

	const historyWorkspacePaths = useMemo(
		() =>
			workspacePathsFromSessions(
				sessionHistory.sessions,
				activeThread?.environmentId ?? activeEnvironmentId,
			),
		[activeEnvironmentId, activeThread?.environmentId, sessionHistory.sessions],
	);
	// A child agent session names its parent, but only the history list knows the
	// parent's title — resolve it here so the chat header can point back to it.
	const activeParentSession = useMemo(() => {
		const parentSessionId =
			activeThread?.historySession?.parentSessionId?.trim();
		if (!parentSessionId) {
			return undefined;
		}
		const title = sessionHistory.threads.find(
			(thread) =>
				thread.id ===
				sessionKey({
					sessionId: parentSessionId,
					environmentId: activeThread.environmentId,
				}),
		)?.title;
		return { sessionId: parentSessionId, title };
	}, [
		activeThread?.historySession?.parentSessionId,
		activeThread?.environmentId,
		sessionHistory.threads,
	]);

	return (
		<AccountProvider>
			<SidebarProvider>
				<WindowTitleBarProvider
					contentEnabled={!showOnboarding && view === "chat"}
				>
					<div
						aria-hidden={showOnboarding ? true : undefined}
						className="flex h-screen w-full overflow-hidden bg-background text-foreground"
						// The onboarding overlay is opaque and sits on top of the whole
						// shell; hiding the shell keeps its aurora + animations from
						// being composited every frame underneath while it still mounts
						// and loads (providers, history, transport) in the background.
						// `inert` additionally keeps the covered controls out of the
						// keyboard tab order and assistive tech while it is hidden.
						inert={showOnboarding ? true : undefined}
						style={showOnboarding ? { visibility: "hidden" } : undefined}
					>
						<Sidebar
							className="border-r border-sidebar-border"
							collapsible="icon"
						>
							<AgentSidebar
								activeSessionId={activeHistorySessionId}
								newTaskActive={newTaskActive}
								onHome={handleHome}
								onNavigateBack={handleNavigateBack}
								onNavigateForward={handleNavigateForward}
								onOpenSearch={handleOpenCommandBar}
								onSettingsSectionChange={handleSettingsSectionChange}
								sessionHistory={sessionHistory}
								setView={handleViewChange}
								settingsSection={settingsSection}
								view={view}
								canNavigateBack={navigation.back.length > 0}
								canNavigateForward={navigation.forward.length > 0}
							/>
							<SidebarRail />
						</Sidebar>
						<SidebarInset className="min-h-0 min-w-0 overflow-hidden">
							<SidebarTrigger className="absolute left-20 top-0 z-40 md:hidden" />
							<WindowTitleBar />
							<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
								{view === "sessions" ? (
									<SessionsView
										activeSessionId={activeHistorySessionId}
										history={sessionHistory}
									/>
								) : activeThread ? (
									<div
										aria-hidden={view === "settings" ? true : undefined}
										className="flex min-h-0 flex-1 flex-col"
										inert={view === "settings" ? true : undefined}
									>
										<ChatThreadPane
											key={`${activeThread.id}:${activeThread.environmentId}`}
											handoffUiState={handoffUiState}
											onHandoffUiAction={dispatchHandoffUi}
											environmentId={activeThread.environmentId}
											environmentProfiles={remoteEnvironmentProfiles}
											environmentProfilesLoading={
												remoteEnvironmentProfilesLoading
											}
											onAddSshHost={() => handleSettingsSectionChange("Remote")}
											onPickRemoteWorkspaceDirectory={
												pickRemoteWorkspaceDirectory
											}
											onSelectEnvironment={handleSelectEnvironment}
											remoteEnvironment={
												activeRemoteEnvironment?.id ===
												activeThread.environmentId
													? activeRemoteEnvironment
													: null
											}
											historySession={activeHistorySession}
											liveHistoryStatus={
												sessionHistory.sessions.find(
													(session) =>
														session.sessionId ===
															activeThread.historySession?.sessionId &&
														(session.environmentId ??
															LOCAL_WORKSPACE_ENVIRONMENT_ID) ===
															activeThread.environmentId,
												)?.status ?? activeHistorySession?.status
											}
											initialAttachments={activeThread.initialAttachments}
											initialPromptDraft={activeThread.initialPromptDraft}
											handoffLifecycle={handoffLifecycle}
											knownWorkspacePaths={historyWorkspacePaths}
											onInitialPromptDraftConsumed={
												handleInitialPromptDraftConsumed
											}
											onUpdateSessionMetadata={(sessionId, metadata) =>
												handleUpdateSessionMetadata(
													sessionId,
													metadata,
													activeThread.environmentId,
												)
											}
											threadId={activeThread.id}
											isThreadActive={() =>
												activeLocationRef.current.activeThreadId ===
													activeThread.id &&
												activeLocationRef.current.view === "chat"
											}
											onDeleteSession={(sessionId, threadId) =>
												handleDeleteSession(
													sessionId,
													threadId,
													activeThread.environmentId,
												)
											}
											onNewThread={handleNewThread}
											onOpenSession={handleOpenSession}
											onOpenSessionById={handleOpenSessionById}
											onOpenSetup={handleOpenSetup}
											onOpenModelSettings={() =>
												handleSettingsSectionChange("Providers")
											}
											onOpenAccountSettings={() =>
												handleSettingsSectionChange("Account")
											}
											parentSession={activeParentSession}
											onThreadStarted={handleThreadStarted}
										/>
									</div>
								) : null}
								{view === "settings" ? (
									<div className="absolute inset-0 z-30 bg-background text-foreground">
										<SettingsView
											onExportDiagnostics={() => setExportDiagnosticsOpen(true)}
											onNavigateSection={handleSettingsSectionChange}
											onOpenSession={handleOpenSessionById}
											section={settingsSection}
										/>
									</div>
								) : null}
							</div>
						</SidebarInset>
					</div>
					{showOnboarding ? (
						<div className="fixed inset-0 z-50 bg-background">
							<WindowTitleBar
								className="absolute inset-x-0 top-0 z-10"
								hostContent={false}
							/>
							<div className="h-full">
								<OnboardingView
									initialStep={onboardingInitialStep}
									onComplete={completeOnboarding}
								/>
							</div>
						</div>
					) : null}
				</WindowTitleBarProvider>
			</SidebarProvider>
			<ExportDiagnosticsDialog
				onOpenChange={setExportDiagnosticsOpen}
				open={exportDiagnosticsOpen}
			/>
			<HubUpdateRequiredDialog />
			<SessionCommandBar
				onOpenChange={setCommandBarOpen}
				onOpenSession={handleOpenSessionById}
				open={commandBarOpen && !showOnboarding}
			/>
			{remoteDirectoryPicker ? (
				<RemoteDirectoryPicker
					environmentId={remoteDirectoryPicker.id}
					homeDir={remoteDirectoryPicker.homeDir}
					onCancel={() => completeRemoteDirectoryPicker(null)}
					onSelect={completeRemoteDirectoryPicker}
					open
				/>
			) : null}
		</AccountProvider>
	);
}

// "+ new chat" remounts ChatThreadPane with a fresh thread id, and the pane
// blocks on the provider catalog (a large fetch) before rendering anything.
// Seed remounts from the last successful load (kept in the catalog module,
// where credential changes invalidate it) so only the first-ever mount shows
// the boot spinner; the effect still refreshes in the background.
let workspacesLoadedOnce = false;

function ChatThreadPane({
	threadId,
	environmentId,
	environmentProfiles,
	environmentProfilesLoading,
	historySession,
	liveHistoryStatus,
	initialAttachments,
	initialPromptDraft,
	handoffLifecycle,
	knownWorkspacePaths,
	onInitialPromptDraftConsumed,
	onUpdateSessionMetadata,
	onAddSshHost,
	onDeleteSession,
	onNewThread,
	onOpenSession,
	onOpenSessionById,
	onOpenSetup,
	onOpenModelSettings,
	onOpenAccountSettings,
	onPickRemoteWorkspaceDirectory,
	onSelectEnvironment,
	parentSession,
	remoteEnvironment,
	onThreadStarted,
	isThreadActive,
	handoffUiState,
	onHandoffUiAction,
}: {
	threadId: string;
	environmentId: string;
	environmentProfiles: RemoteEnvironmentProfile[];
	environmentProfilesLoading: boolean;
	historySession?: SessionHistoryItem;
	liveHistoryStatus?: SessionHistoryItem["status"];
	/** Attachments to restore into the composer alongside initialPromptDraft. */
	initialAttachments?: File[];
	initialPromptDraft?: string;
	/** Home-level coordinator owning handoff completion/failure ordering. */
	handoffLifecycle: Pick<
		HandoffLifecycle,
		"onRpcStarted" | "onRpcResolved" | "onRpcRejected"
	>;
	knownWorkspacePaths: string[];
	onInitialPromptDraftConsumed?: (threadId: string) => void;
	onUpdateSessionMetadata?: (
		sessionId: string,
		metadata: SessionMetadata,
	) => void;
	onAddSshHost: () => void;
	onDeleteSession?: (sessionId: string, threadId?: string) => void;
	onNewThread?: () => void;
	onOpenSession?: (
		session: SessionHistoryItem,
		initialPromptDraft?: string,
		initialAttachments?: File[],
	) => void;
	onOpenSessionById?: (
		sessionId: string,
		optionsOrEnvironment?:
			| string
			| {
					environmentId?: string;
					silent?: boolean;
					initialPromptDraft?: string;
					initialAttachments?: File[];
			  },
	) => boolean | Promise<boolean>;
	onPickRemoteWorkspaceDirectory: (
		environment: RemoteWorkspaceEnvironment,
	) => Promise<string | null>;
	onSelectEnvironment: (environmentId: string) => Promise<void>;
	onOpenSetup?: () => void;
	onOpenModelSettings?: () => void;
	onOpenAccountSettings?: () => void;
	parentSession?: { sessionId: string; title?: string };
	onThreadStarted?: (threadId: string, sessionId?: string) => void;
	isThreadActive?: () => boolean;
	handoffUiState: CloudHandoffUiState;
	onHandoffUiAction: (action: CloudHandoffUiAction) => void;
	remoteEnvironment: RemoteWorkspaceEnvironment | null;
}) {
	const {
		sessionId,
		status,
		chatTransportState,
		chatTransportError,
		isHydratingSession,
		isCloudSessionExpired,
		activeAssistantMessageId,
		activityLabel,
		config,
		messages,
		error,
		summary,
		fileDiffs,
		promptsInQueue,
		pendingToolApprovals,
		pendingAskQuestions,
		setConfig,
		setWorkspacePath,
		sendPrompt,
		steerPromptInQueue,
		updatePromptInQueue,
		removePromptInQueue,
		approveToolApproval,
		rejectToolApproval,
		answerAskQuestion,
		restoreCheckpoint,
		forkSession,
		proceedWhileRunning,
		reset,
		abort,
		hydrateSession,
	} = useChatSession(environmentId);
	// Bind the runtime session to the thread so deleting it elsewhere (e.g.
	// the sidebar) can close this pane even when it was not opened from history.
	useEffect(() => {
		if (sessionId) {
			onThreadStarted?.(threadId, sessionId);
		}
	}, [onThreadStarted, sessionId, threadId]);
	// The live composer text lives inside ChatInputBar so typing does not
	// re-render this whole pane. The pane mirrors it in a ref (for reads) and
	// pushes external updates (quick actions, undo, resets) via promptDraft.
	const promptInputRef = useRef("");
	const [promptDraft, setPromptDraft] = useState({ version: 0, value: "" });
	const setPromptInput = useCallback((value: string) => {
		promptInputRef.current = value;
		setPromptDraft((prev) => ({ version: prev.version + 1, value }));
	}, []);
	const handlePromptInputChange = useCallback((value: string) => {
		promptInputRef.current = value;
	}, []);
	const [pendingAttachments, setPendingAttachments] = usePendingAttachments();
	const [workInSelection, setWorkInSelection] =
		useState<WorkIn>(readWorkInFromWindow);
	const setWorkIn = useCallback((next: WorkIn) => {
		setWorkInSelection(next);
		writeWorkInToWindow(next);
	}, []);
	const [showDiffView, setShowDiffView] = useState(false);
	const [deletingSession, setDeletingSession] = useState(false);
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [renamingSession, setRenamingSession] = useState(false);
	const [manualTitle, setManualTitle] = useState("");
	const [dismissedHistorySessionId, setDismissedHistorySessionId] = useState<
		string | null
	>(null);
	// Branch name, "no-git" once the folder is confirmed to not be a git
	// repository, or null while branch discovery is pending.
	const [gitBranch, setGitBranch] = useState<string | null>(null);
	// Re-evaluate the account-targeted flag after sign-in changes.
	const [cloudAgentsFlagEnabled, setCloudAgentsFlagEnabled] = useState(false);
	const cloudAgentsEnabled =
		cloudAgentsFlagEnabled && environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID;
	const cloudHandoffAvailable = cloudAgentsEnabled;
	const handoffStartingRef = useRef(false);
	const sourceSessionId = sessionId ?? historySession?.sessionId;
	const handoffUi = sourceSessionId
		? handoffUiState[sourceSessionId]
		: undefined;
	const handoffProgress = handoffUi?.status === "progress" ? handoffUi : null;
	const pendingHandoffRecovery = readPendingHandoffRecovery(
		historySession?.metadata,
	);
	const handoffRetryEligible =
		Boolean(pendingHandoffRecovery) ||
		handoffUi?.status === "recovery" ||
		handoffUi?.status === "recovery_dismissed" ||
		handoffUi?.status === "failed" ||
		handoffUi?.status === "retry_restored";
	const handoffOwnershipPending =
		Boolean(pendingHandoffRecovery) || hasLivePendingHandoff(handoffUi);
	const dismissedHandoffRecoveryUrl =
		handoffUi?.status === "recovery_dismissed" ? handoffUi.dashboardUrl : null;
	const handoffRecoveryUrl =
		(handoffUi?.status === "recovery" ? handoffUi.dashboardUrl : null) ??
		(pendingHandoffRecovery?.dashboardUrl !== dismissedHandoffRecoveryUrl
			? pendingHandoffRecovery?.dashboardUrl
			: null) ??
		null;
	const handoffRetry =
		(handoffUi?.status === "recovery" ||
			handoffUi?.status === "recovery_dismissed" ||
			handoffUi?.status === "failed" ||
			handoffUi?.status === "retry_restored") &&
		(handoffUi.retryDraft || handoffUi.retryAttachments?.length)
			? {
					draft: handoffUi.retryDraft,
					attachments: handoffUi.retryAttachments,
				}
			: null;
	const handoffReceipt = resolveHandoffReceipt(
		handoffUi,
		readHandoffReceipt(historySession?.metadata),
	);
	const handoffExternalPresentation =
		handoffUi?.status === "complete" && handoffUi.externalPresentation;
	const { user: accountUser, activeOrganization } = useAccount();
	const accountUserId = accountUser?.id ?? null;
	const openGitHubConnect = useCallback(
		async (fallbackUrl: string) => {
			if (activeOrganization) {
				await openExternalUrl(fallbackUrl);
				return;
			}
			await openPersonalGitHubInstallUrl(fallbackUrl);
		},
		[activeOrganization],
	);
	useEffect(() => {
		void accountUserId;
		let cancelled = false;
		let retryTimer: number | undefined;
		let attempts = 0;
		const fetchFlags = () => {
			desktopClient
				.invoke("get_feature_flags", {})
				.then((flags) => {
					if (!cancelled) {
						setCloudAgentsFlagEnabled(
							Boolean((flags as { cloudAgents?: boolean })?.cloudAgents),
						);
					}
				})
				.catch(() => {
					attempts += 1;
					if (!cancelled && attempts < 10) {
						retryTimer = window.setTimeout(fetchFlags, 2_000);
					}
				});
		};
		fetchFlags();
		// Reflect Settings changes without restarting or switching accounts.
		const unsubscribe = desktopClient.subscribe(
			"feature_flags_changed",
			(payload) => {
				if (!cancelled) {
					setCloudAgentsFlagEnabled(
						Boolean((payload as { cloudAgents?: boolean })?.cloudAgents),
					);
				}
			},
		);
		return () => {
			cancelled = true;
			unsubscribe();
			if (retryTimer !== undefined) window.clearTimeout(retryTimer);
		};
	}, [accountUserId]);
	// Worktrees are cut by the local sidecar's git, so they are only offered
	// for the local environment. The choice also only holds while the
	// workspace is a git repo; a plain folder (or pending discovery) silently
	// falls back to running locally.
	const canWorkInWorktree =
		environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID &&
		config.executionTarget !== "cloud" &&
		historySession?.origin !== "cloud";
	const workIn: WorkIn =
		canWorkInWorktree &&
		workInSelection === "worktree" &&
		gitBranch &&
		gitBranch !== "no-git"
			? "worktree"
			: "local";
	const [providerCredentials, setProviderCredentials] = useState<
		Record<string, { apiKey: string }>
	>(() => readProviderCatalogSnapshot()?.credentials ?? {});
	const [providerModelContextWindows, setProviderModelContextWindows] =
		useState<Record<string, Record<string, number>>>(
			() => readProviderCatalogSnapshot()?.contextWindows ?? {},
		);
	const [providersLoaded, setProvidersLoaded] = useState(
		() => readProviderCatalogSnapshot() !== null,
	);
	// null = unknown (catalog unavailable): never nag in that case.
	const [hasConnectedProvider, setHasConnectedProvider] = useState<
		boolean | null
	>(null);
	// History paths lead each merge: they are ordered by session recency, so
	// stored or stale entries only append after them.
	const [workspaces, setWorkspaces] = useState<string[]>(() =>
		filterWorkspacePaths(
			mergeWorkspacePaths(
				knownWorkspacePaths,
				readWorkspaceSelectionFromWindow(environmentId).workspaces,
			),
		),
	);
	const [workspacesLoaded, setWorkspacesLoaded] = useState(
		() => workspacesLoadedOnce,
	);
	const hydratedSessionRef = useRef<string | null>(null);
	const resetThreadRef = useRef<string | null>(null);
	const manualTitleSessionRef = useRef<string | null>(null);
	const workspaceSelectionRequestRef = useRef(0);
	const gitBranchRequestGateRef = useRef(createLatestSuccessfulRequestGate());
	const workspaceRef = useRef({
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
	});
	workspaceRef.current = {
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
	};
	const isCloudSession =
		config.executionTarget === "cloud" || historySession?.origin === "cloud";
	const headerStatus = resolveSessionHeaderStatus({
		chatStatus: status,
		isCloudSession,
		liveHistoryStatus,
	});
	const [liveProvisioningPhase, setLiveProvisioningPhase] =
		useState<CloudProvisioningPhase>();
	useEffect(() => {
		setLiveProvisioningPhase(undefined);
		return desktopClient.subscribe("chat_session_status", (payload) => {
			if (
				payload &&
				typeof payload === "object" &&
				"sessionId" in payload &&
				payload.sessionId === sessionId &&
				"phase" in payload
			) {
				setLiveProvisioningPhase(
					payload.phase === "ready"
						? undefined
						: readCloudProvisioningPhase(payload.phase),
				);
			}
		});
	}, [sessionId]);
	const isProvisioningCloudSession =
		isCloudSession &&
		status === "starting" &&
		(liveHistoryStatus === "provisioning" ||
			liveProvisioningPhase !== undefined);
	const provisioningPhase = useCloudProvisioningPhase(
		config.repoUrl || historySession?.repoUrl,
		isCloudSession && status === "starting",
		liveProvisioningPhase ??
			readCloudProvisioningPhase(historySession?.metadata?.provisioningPhase),
		historySession?.startedAt,
	);
	const activeWorkspaceCwd = isCloudSession
		? ""
		: (config.cwd || config.workspaceRoot || "").trim();
	const localConfigRef = useRef<
		Pick<
			ChatSessionConfig,
			"provider" | "model" | "apiKey" | "workspaceRoot" | "cwd"
		>
	>({
		provider: config.provider,
		model: config.model,
		apiKey: config.apiKey,
		workspaceRoot: config.workspaceRoot,
		cwd: config.cwd,
	});

	useEffect(() => {
		setWorkspaces((current) => {
			const stored = readWorkspaceSelectionFromWindow(environmentId);
			const merged = filterWorkspacePaths(
				mergeWorkspacePaths(knownWorkspacePaths, stored.workspaces),
			);
			return current.length === merged.length &&
				current.every((workspace, index) => workspace === merged[index])
				? current
				: merged;
		});
	}, [environmentId, knownWorkspacePaths]);

	useEffect(() => {
		// Do not persist a sandbox's synthetic path as the local workspace.
		if (
			config.executionTarget === "cloud" ||
			(config.environmentId ?? LOCAL_WORKSPACE_ENVIRONMENT_ID) !== environmentId
		) {
			return;
		}
		const active = (config.workspaceRoot || config.cwd || "").trim();
		// A task worktree is transient: keep remembering the repo it was cut
		// from, so the next thread (and next launch) start back on that repo.
		const lastWorkspace = isTaskWorktreePath(active)
			? readWorkspaceSelectionFromWindow(environmentId).lastWorkspace
			: active;
		writeWorkspaceSelectionToWindow(environmentId, {
			lastWorkspace,
			workspaces: mergeWorkspacePaths(workspaces, [lastWorkspace]),
		});
	}, [
		config.cwd,
		config.environmentId,
		config.executionTarget,
		config.workspaceRoot,
		environmentId,
		workspaces,
	]);

	const providerCredentialsRequestRef = useRef(0);
	const loadProviderCredentials = useCallback(async () => {
		const requestId = ++providerCredentialsRequestRef.current;
		try {
			const payload = await fetchProviderCatalog();
			if (providerCredentialsRequestRef.current !== requestId) {
				return;
			}
			const next: Record<string, { apiKey: string }> = {};
			const nextContextWindows: Record<string, Record<string, number>> = {};
			let anyConnected = false;
			for (const provider of payload.providers ?? []) {
				const id = provider.id?.trim();
				if (!id) {
					continue;
				}
				next[id] = {
					apiKey: provider.apiKey?.trim() ?? "",
				};
				if (isProviderConnected(provider)) {
					anyConnected = true;
				}
				const contextWindows: Record<string, number> = {};
				for (const model of provider.modelList ?? []) {
					if (
						model.id &&
						typeof model.contextWindow === "number" &&
						Number.isFinite(model.contextWindow) &&
						model.contextWindow > 0
					) {
						contextWindows[model.id] = model.contextWindow;
					}
				}
				nextContextWindows[id] = contextWindows;
			}
			writeProviderCatalogSnapshot({
				credentials: next,
				contextWindows: nextContextWindows,
			});
			setProviderCredentials(next);
			setProviderModelContextWindows(nextContextWindows);
			setHasConnectedProvider(anyConnected);
		} catch {
			// Keep current config if provider catalog cannot be read.
		} finally {
			if (providerCredentialsRequestRef.current === requestId) {
				setProvidersLoaded(true);
			}
		}
	}, []);

	useEffect(() => {
		void loadProviderCredentials();
		// Credentials saved elsewhere (settings, onboarding, OAuth) invalidate
		// the catalog cache; reload so the setup notice reflects reality
		// without waiting for a pane remount.
		return subscribeToProviderCatalogInvalidation(() => {
			void loadProviderCredentials();
		});
	}, [loadProviderCredentials]);

	const modelContextWindow =
		providerModelContextWindows[config.provider.trim()]?.[config.model.trim()];

	useEffect(() => {
		const selected = providerCredentials[config.provider];
		if (!selected) {
			return;
		}
		const nextApiKey = selected.apiKey;
		if (config.apiKey === nextApiKey) {
			return;
		}
		setConfig((prev) => ({
			...prev,
			apiKey: nextApiKey,
		}));
	}, [config.apiKey, config.provider, providerCredentials, setConfig]);

	const getWorkspaceCwd = useCallback(
		() =>
			workspaceRef.current.cwd ||
			workspaceRef.current.workspaceRoot ||
			undefined,
		[],
	);

	const refreshGitBranch = useCallback(async () => {
		const requestId = gitBranchRequestGateRef.current.begin();
		const cwd = getWorkspaceCwd();
		if (!cwd) {
			if (gitBranchRequestGateRef.current.commit(requestId)) {
				setGitBranch("no-git");
			}
			return;
		}
		try {
			const payload = await desktopClient.invoke<{
				environmentId: string;
				branch?: string;
			}>("get_git_branch", { cwd, environmentId });
			if (payload.environmentId !== environmentId) {
				return;
			}
			if (!gitBranchRequestGateRef.current.commit(requestId)) {
				return;
			}
			const branch = payload?.branch?.trim();
			setGitBranch(branch && branch.length > 0 ? branch : "no-git");
		} catch {
			// Preserve the latest successful branch through transient failures.
		}
	}, [environmentId, getWorkspaceCwd]);

	const invalidateGitBranch = useCallback(() => {
		gitBranchRequestGateRef.current.invalidate();
		// Back to pending: the next workspace hasn't been classified yet, so
		// don't report it as a confirmed non-repo in the meantime.
		setGitBranch(null);
	}, []);

	const listGitBranches = useCallback(async (): Promise<{
		current: string;
		branches: string[];
	}> => {
		const cwd = getWorkspaceCwd();
		if (!cwd) {
			return { current: "no-git", branches: [] };
		}
		try {
			const payload = await desktopClient.invoke<{
				environmentId: string;
				current?: string;
				branches?: string[];
			}>("list_git_branches", { cwd, environmentId });
			if (payload.environmentId !== environmentId) {
				return { current: "no-git", branches: [] };
			}
			const current = payload?.current?.trim() || "no-git";
			const branches = Array.isArray(payload?.branches)
				? payload.branches.filter((item) => item.trim().length > 0)
				: [];
			return { current, branches };
		} catch {
			return { current: "no-git", branches: [] };
		}
	}, [environmentId, getWorkspaceCwd]);

	const switchGitBranch = useCallback(
		async (nextBranch: string): Promise<boolean> => {
			const cwd = getWorkspaceCwd();
			if (!cwd) {
				return false;
			}
			try {
				const payload = await desktopClient.invoke<{
					environmentId: string;
					branch?: string;
				}>("checkout_git_branch", {
					cwd,
					branch: nextBranch,
					environmentId,
				});
				if (payload.environmentId !== environmentId) {
					return false;
				}
				invalidateGitBranch();
				await refreshGitBranch();
				return true;
			} catch {
				return false;
			}
		},
		[environmentId, getWorkspaceCwd, invalidateGitBranch, refreshGitBranch],
	);

	const listWorkspaces = useCallback(
		async (preferredWorkspace?: string): Promise<string[]> => {
			const preferred = (preferredWorkspace || "").trim();
			const current = (
				workspaceRef.current.workspaceRoot ||
				workspaceRef.current.cwd ||
				""
			).trim();
			// The active workspace can be an excluded path (restored session,
			// process cwd fallback); it renders via its own registration in the
			// selector and welcome screen instead of joining the catalog.
			return filterWorkspacePaths(
				mergeWorkspacePaths(
					knownWorkspacePaths,
					readWorkspaceSelectionFromWindow(environmentId).workspaces,
					[preferred, current],
				),
			);
		},
		[environmentId, knownWorkspacePaths],
	);

	const refreshWorkspaces = useCallback(
		async (preferredWorkspace?: string) => {
			try {
				const results = await listWorkspaces(preferredWorkspace);
				setWorkspaces((current) => {
					const merged = results;
					return current.length === merged.length &&
						current.every((workspace, index) => workspace === merged[index])
						? current
						: merged;
				});
			} finally {
				workspacesLoadedOnce = true;
				setWorkspacesLoaded(true);
			}
		},
		[listWorkspaces],
	);

	useEffect(() => {
		void refreshWorkspaces();
	}, [refreshWorkspaces]);

	const switchWorkspace = useCallback(
		async (workspacePath: string): Promise<boolean> => {
			const nextWorkspace = workspacePath.trim();
			if (!nextWorkspace) {
				return false;
			}
			const requestId = ++workspaceSelectionRequestRef.current;
			const normalizedNext = normalizeWorkspacePath(nextWorkspace);
			const normalizedCurrent = normalizeWorkspacePath(
				workspaceRef.current.workspaceRoot || workspaceRef.current.cwd || "",
			);
			if (normalizedNext === normalizedCurrent) {
				return true;
			}
			const validation = await desktopClient
				.invoke<{
					valid?: boolean;
					path?: string;
				}>("validate_workspace_directory", {
					environmentId,
					path: nextWorkspace,
				})
				.catch(() => ({ valid: false, path: undefined }));
			if (validation.valid !== true) {
				return false;
			}
			if (requestId !== workspaceSelectionRequestRef.current) {
				return false;
			}

			// The sidecar may resolve shorthand input (e.g. "~/projects/app")
			// into an absolute path; adopt the resolved form.
			const resolvedWorkspace =
				typeof validation.path === "string" && validation.path.trim()
					? validation.path.trim()
					: nextWorkspace;

			invalidateGitBranch();
			setWorkspacePath(resolvedWorkspace);
			setWorkspaces((prev) =>
				filterWorkspacePaths(mergeWorkspacePaths(prev, [resolvedWorkspace])),
			);

			// Refresh the merged history, stored, and current workspace catalog.
			void refreshWorkspaces(resolvedWorkspace);

			return true;
		},
		[environmentId, invalidateGitBranch, refreshWorkspaces, setWorkspacePath],
	);

	const selectChat = useCallback(async (): Promise<boolean> => {
		workspaceSelectionRequestRef.current += 1;
		invalidateGitBranch();
		setWorkspacePath("");
		return true;
	}, [invalidateGitBranch, setWorkspacePath]);
	const pickWorkspaceDirectory = useCallback(
		async (initialPath?: string): Promise<string | null> => {
			// Resolves to null when the user cancels; rethrows picker failures
			// (e.g. no zenity/kdialog on Linux) so callers can surface an error
			// and offer manual path entry instead of a silent no-op.
			if (remoteEnvironment) {
				return await onPickRemoteWorkspaceDirectory(remoteEnvironment);
			}
			try {
				const selected = await desktopClient.invoke<string | null>(
					"pick_workspace_directory",
					{
						environmentId,
						initialPath: initialPath?.trim() || undefined,
					},
				);
				if (typeof selected !== "string") {
					return null;
				}
				const trimmed = selected.trim();
				return trimmed.length > 0 ? trimmed : null;
			} catch (error) {
				throw new Error(
					error instanceof Error && error.message.trim()
						? error.message
						: "The folder picker could not be opened.",
				);
			}
		},
		[environmentId, onPickRemoteWorkspaceDirectory, remoteEnvironment],
	);

	// Let the sidecar load the workspace's plugin sandbox now so the slash
	// menu lists plugin commands without paying the cold spawn on first open.
	useEffect(() => {
		if (!activeWorkspaceCwd) {
			return;
		}
		void desktopClient
			.invoke("warm_plugin_commands", {
				workspacePath: activeWorkspaceCwd,
				environmentId,
			})
			.catch(() => {
				// Best effort; the menu falls back to loading on open.
			});
	}, [activeWorkspaceCwd, environmentId]);

	useEffect(() => {
		void refreshGitBranch();
		if (!activeWorkspaceCwd) {
			return;
		}

		const refreshVisibleBranch = () => {
			if (document.visibilityState === "visible") {
				void refreshGitBranch();
			}
		};
		const intervalId = window.setInterval(
			refreshVisibleBranch,
			GIT_BRANCH_REFRESH_INTERVAL_MS,
		);
		window.addEventListener("focus", refreshVisibleBranch);
		document.addEventListener("visibilitychange", refreshVisibleBranch);
		return () => {
			window.clearInterval(intervalId);
			window.removeEventListener("focus", refreshVisibleBranch);
			document.removeEventListener("visibilitychange", refreshVisibleBranch);
		};
	}, [activeWorkspaceCwd, refreshGitBranch]);

	useEffect(() => {
		setDismissedHistorySessionId(null);
	}, []);

	useEffect(() => {
		if (historySession) {
			resetThreadRef.current = null;
			const nextSessionId = historySession.sessionId;
			const metadataTitle = getSessionMetadataTitle(historySession.metadata);
			const hasSessionChanged = manualTitleSessionRef.current !== nextSessionId;
			if (hasSessionChanged) {
				manualTitleSessionRef.current = nextSessionId;
				setManualTitle(metadataTitle);
				return;
			}
			// Keep locally renamed title for this session unless metadata now contains one.
			if (!manualTitle && metadataTitle) {
				setManualTitle(metadataTitle);
			}
			return;
		}
		if (resetThreadRef.current === threadId) {
			return;
		}
		resetThreadRef.current = threadId;
		hydratedSessionRef.current = null;
		manualTitleSessionRef.current = null;
		setPromptInput("");
		setPendingAttachments([]);
		setManualTitle("");
		void reset();
	}, [
		historySession,
		manualTitle,
		reset,
		threadId,
		setPromptInput,
		setPendingAttachments,
	]);

	useEffect(() => {
		if (!historySession) {
			return;
		}
		const hasInitialComposerState =
			initialPromptDraft !== undefined || initialAttachments !== undefined;
		if (hasInitialComposerState) {
			setPromptInput(initialPromptDraft ?? "");
			setPendingAttachments(initialAttachments ? [...initialAttachments] : []);
			onInitialPromptDraftConsumed?.(threadId);
		}
		if (hydratedSessionRef.current === historySession.sessionId) {
			return;
		}
		hydratedSessionRef.current = historySession.sessionId;
		if (!hasInitialComposerState) {
			setPromptInput("");
			setPendingAttachments([]);
		}
		setManualTitle(getSessionMetadataTitle(historySession.metadata));
		void hydrateSession(historySession);
	}, [
		historySession,
		hydrateSession,
		initialAttachments,
		initialPromptDraft,
		onInitialPromptDraftConsumed,
		setPendingAttachments,
		setPromptInput,
		threadId,
	]);

	const isNewThread = startsNewThread(sessionId, messages);

	const handleAttachFiles = useCallback(
		(files: File[]) => {
			const supportedFiles = files.filter((file) =>
				isCloudSession
					? isSupportedImageAttachment(file)
					: !isUnsupportedImageAttachment(file),
			);
			if (supportedFiles.length !== files.length) {
				toast({
					title: isCloudSession
						? "Unsupported cloud attachment"
						: "Unsupported image format",
					description: isCloudSession
						? "Choose PNG, JPEG, GIF, or WebP images, or switch to Local to attach other files."
						: "Convert the image to PNG, JPEG, GIF, or WebP before attaching it.",
				});
			}
			setPendingAttachments((current) => {
				const existing = new Set(
					current.map(
						(file) => `${file.name}:${file.size}:${file.lastModified}`,
					),
				);
				const next = [...current];
				for (const file of supportedFiles) {
					const key = `${file.name}:${file.size}:${file.lastModified}`;
					if (!existing.has(key)) {
						existing.add(key);
						next.push(file);
					}
				}
				const error = isCloudSession && cloudImageAttachmentError(next);
				if (error) {
					toast({ title: "Cloud attachment limit", description: error });
					return current;
				}
				return next;
			});
		},
		[isCloudSession, setPendingAttachments],
	);

	// Hydrate first, then restore a failed handoff's draft and attachments. If
	// this ran above the hydration effect, hydration would immediately wipe the
	// only retained retry payload after navigation back to the source session.
	const restoredHandoffRetryRef = useRef<{
		sourceSessionId: string;
		draft?: string;
		attachments?: File[];
	} | null>(null);
	useEffect(() => {
		if (!sourceSessionId || !handoffRetry) {
			restoredHandoffRetryRef.current = null;
			return;
		}
		const restored = restoredHandoffRetryRef.current;
		if (
			restored?.sourceSessionId === sourceSessionId &&
			restored.draft === handoffRetry.draft &&
			restored.attachments === handoffRetry.attachments
		) {
			return;
		}
		restoredHandoffRetryRef.current = {
			sourceSessionId,
			draft: handoffRetry.draft,
			attachments: handoffRetry.attachments,
		};
		if (handoffRetry.draft) setPromptInput(handoffRetry.draft);
		if (handoffRetry.attachments?.length) {
			setPendingAttachments([...handoffRetry.attachments]);
		}
		if (handoffUi?.status !== "retry_restored") {
			onHandoffUiAction({
				type: "retry_restored",
				sourceSessionId,
			});
		}
	}, [
		handoffRetry,
		handoffUi?.status,
		onHandoffUiAction,
		setPendingAttachments,
		setPromptInput,
		sourceSessionId,
	]);

	const runHandoff = useCallback(
		async (
			preflight: HandoffPreflight,
			nextCommand: string,
			sourceAttachments: File[],
			attachments: SerializedAttachments,
			sourceSessionId: string,
			handoffAttemptId: string,
			pendingPrompt?: PendingHandoffPrompt,
		) => {
			onHandoffUiAction({
				type: "progress",
				sourceSessionId,
				phase: "creating",
			});
			try {
				const result = await desktopClient.invoke<HandoffResult>(
					"chat_session_command",
					{
						request: {
							action: "handoff",
							sessionId: sourceSessionId,
							config,
							fingerprint: preflight.fingerprint,
							handoffAttemptId,
							nextCommand: nextCommand || undefined,
							attachments:
								attachments.userImages.length > 0 ? attachments : undefined,
						},
					},
					{ timeoutMs: HANDOFF_INVOKE_TIMEOUT_MS },
				);
				await handoffLifecycle.onRpcResolved(sourceSessionId, {
					handoffAttemptId,
					result,
					nextCommand,
					sourceAttachments,
					pendingPrompt,
					isThreadActive,
				});
			} catch (error) {
				await handoffLifecycle.onRpcRejected(sourceSessionId, {
					handoffAttemptId,
					error,
					nextCommand,
					sourceAttachments,
					isThreadActive,
				});
			}
		},
		[config, handoffLifecycle, isThreadActive, onHandoffUiAction],
	);

	const prepareHandoff = useCallback(
		async (nextCommand: string) => {
			const sourceSessionId = sessionId ?? historySession?.sessionId;
			if (isCloudSession) {
				setPromptInput(nextCommand ? `/cloud ${nextCommand}` : "/cloud");
				toast({
					title: "Already in Cline Cloud",
					description: "Handoff is available from local sessions.",
				});
				return;
			}
			// A PENDING handoff must stay retryable after either gate flips
			// off — the source session's normal actions are blocked by the
			// pending guard, so gating the retry here would lock it forever.
			// The sidecar applies the same recovery exemption on its side.
			if (!cloudHandoffAvailable && !handoffRetryEligible) {
				setPromptInput(nextCommand ? `/cloud ${nextCommand}` : "/cloud");
				toast({
					title: "Cloud handoff is not available",
					description: "Enable Cloud sessions in Settings before using /cloud.",
				});
				return;
			}
			if (!sourceSessionId) {
				setPromptInput(nextCommand ? `/cloud ${nextCommand}` : "/cloud");
				toast({
					title: "Start the local session first",
					description: "Send at least one message before handing off to cloud.",
				});
				return;
			}
			if (
				status === "starting" ||
				status === "running" ||
				status === "stopping" ||
				promptsInQueue.length > 0
			) {
				setPromptInput(nextCommand ? `/cloud ${nextCommand}` : "/cloud");
				toast({
					title: "Wait for the current turn",
					description:
						"Handoff can start once the local agent is idle and its prompt queue is empty.",
				});
				return;
			}
			const attachmentError = validateHandoffAttachments(
				pendingAttachments,
				nextCommand,
			);
			if (attachmentError) {
				setPromptInput(nextCommand ? `/cloud ${nextCommand}` : "/cloud");
				toast({
					title: "Handoff is not ready",
					description: attachmentError,
					variant: "destructive",
				});
				return;
			}

			if (handoffStartingRef.current) {
				toast({
					title: "Handoff is already starting",
					description: "Wait for the current handoff request to finish.",
				});
				return;
			}
			handoffStartingRef.current = true;
			const sourceAttachments = [...pendingAttachments];
			const handoffAttemptId = handoffLifecycle.onRpcStarted(
				sourceSessionId,
				threadId,
			);
			const submittedAt = Date.now();
			setPendingAttachments([]);
			try {
				const attachments = await serializeAttachments(sourceAttachments);
				const pendingPrompt: PendingHandoffPrompt | undefined = nextCommand
					? {
							content: nextCommand,
							submittedAt,
							baselineOccurrences: matchingUserPromptCount(
								messages,
								nextCommand,
							),
							baselineTailMessageId: pendingHandoffRecovery
								? undefined
								: messages.at(-1)?.id,
							images: toChatMessageImages(
								attachments.userImages,
								`handoff_prompt_${sourceSessionId}`,
							),
						}
					: undefined;
				onHandoffUiAction({
					type: "start",
					sourceSessionId,
					pendingPrompt,
				});
				const preflight = await desktopClient.invoke<HandoffPreflight>(
					"chat_session_command",
					{
						request: {
							action: "prepare_handoff",
							sessionId: sourceSessionId,
							config,
						},
					},
				);
				await runHandoff(
					preflight,
					nextCommand,
					sourceAttachments,
					attachments,
					sourceSessionId,
					handoffAttemptId,
					pendingPrompt,
				);
			} catch (error) {
				await handoffLifecycle.onRpcRejected(sourceSessionId, {
					handoffAttemptId,
					error,
					nextCommand,
					sourceAttachments,
					isThreadActive,
				});
			} finally {
				handoffStartingRef.current = false;
			}
		},
		[
			cloudHandoffAvailable,
			config,
			handoffRetryEligible,
			handoffLifecycle,
			historySession?.sessionId,
			isCloudSession,
			isThreadActive,
			messages,
			pendingAttachments,
			pendingHandoffRecovery,
			promptsInQueue.length,
			runHandoff,
			sessionId,
			setPendingAttachments,
			setPromptInput,
			status,
			onHandoffUiAction,
			threadId,
		],
	);

	const handleSend = useCallback(
		async (prompt: string) => {
			const trimmed = prompt.trim();
			const handoff = parseHandoffCommand(trimmed);
			// Only reserve /cloud when the Cloud sessions gate is on (or a pending
			// handoff needs its retry path); otherwise a user's own workflow
			// or skill named "cloud" stays reachable.
			if (handoff && (cloudHandoffAvailable || handoffRetryEligible)) {
				await prepareHandoff(handoff.nextCommand);
				return;
			}
			if (!handoff && handoffOwnershipPending) {
				setPromptInput(prompt);
				toast({
					title: "Cloud handoff is still pending",
					description:
						"Retry /cloud or use the recovery link before sending another prompt.",
				});
				return;
			}
			if (!trimmed && pendingAttachments.length === 0) {
				return;
			}
			if (isCloudSession && !sessionId && !config.repoUrl?.trim()) {
				return;
			}
			onThreadStarted?.(threadId);
			// Also clear the injected draft: the composer cleared its local copy,
			// but a stale non-empty draft would repopulate the input if the
			// composer remounts (e.g. a transport blip re-showing the loader).
			setPromptInput("");
			const toSend = [...pendingAttachments];
			setPendingAttachments([]);
			const promptTaken = await sendPrompt(trimmed, toSend, {
				inNewWorktree: workIn === "worktree" && isNewThread,
			});
			// The prompt never reached the runtime (e.g. the provider connection
			// failed): hand it back so the user can fix the provider and resend
			// without retyping. Leave anything they typed meanwhile alone.
			if (!promptTaken && promptInputRef.current.trim() === "") {
				setPromptInput(trimmed);
				handleAttachFiles(toSend);
			}
		},
		[
			config.repoUrl,
			handleAttachFiles,
			isCloudSession,
			isNewThread,
			onThreadStarted,
			pendingAttachments,
			prepareHandoff,
			sendPrompt,
			sessionId,
			setPendingAttachments,
			setPromptInput,
			threadId,
			cloudHandoffAvailable,
			handoffRetryEligible,
			handoffOwnershipPending,
			workIn,
		],
	);

	const handleReasoningChange = useCallback(
		(next: Pick<ChatSessionConfig, "thinking" | "reasoningEffort">) => {
			setConfig((prev) => {
				if (
					prev.thinking === next.thinking &&
					prev.reasoningEffort === next.reasoningEffort
				) {
					return prev;
				}
				return {
					...prev,
					thinking: next.thinking,
					reasoningEffort:
						next.thinking === false ? undefined : next.reasoningEffort,
				};
			});
		},
		[setConfig],
	);

	const handleRemoveQueuedPrompt = useCallback(
		async (promptId: string) => {
			await removePromptInQueue(promptId);
		},
		[removePromptInQueue],
	);
	const handleApproveToolApproval = useCallback(
		(requestId: string) => {
			void approveToolApproval(requestId);
		},
		[approveToolApproval],
	);
	const handleRejectToolApproval = useCallback(
		(requestId: string) => {
			void rejectToolApproval(requestId);
		},
		[rejectToolApproval],
	);
	const handleAnswerAskQuestion = useCallback(
		(requestId: string, answer: string) => {
			void answerAskQuestion(requestId, answer);
		},
		[answerAskQuestion],
	);
	const handleRestoreCheckpoint = useCallback(
		(runCount: number) => restoreCheckpoint(runCount),
		[restoreCheckpoint],
	);

	const openForkedSession = useCallback(
		(
			result: Awaited<ReturnType<typeof forkSession>>,
			editedPrompt?: string,
		) => {
			if (!onOpenSession) {
				return;
			}
			const workspaceRoot = config.workspaceRoot;
			const cwd = config.cwd ?? workspaceRoot;
			const forkedHistorySession: SessionHistoryItem = {
				sessionId: result.newSessionId,
				environmentId: config.environmentId,
				status: "completed",
				provider: config.provider,
				model: config.model,
				cwd,
				workspaceRoot,
				startedAt: new Date().toISOString(),
				metadata: {
					fork: {
						forkedFromSessionId: result.forkedFromSessionId,
						forkedAt: new Date().toISOString(),
					},
				},
			};
			onOpenSession(forkedHistorySession, editedPrompt);
		},
		[config, onOpenSession],
	);

	const handleForkSession = useCallback(async () => {
		const result = await forkSession();
		openForkedSession(result);
	}, [forkSession, openForkedSession]);
	const handleFixCredentials = useCallback(
		(target: "account" | "models") => {
			if (target === "account") {
				onOpenAccountSettings?.();
			} else {
				onOpenModelSettings?.();
			}
		},
		[onOpenAccountSettings, onOpenModelSettings],
	);

	const handleEditMessage = useCallback(
		async (_messageId: string, content: string, runCount: number) => {
			const result = await forkSession({ beforeRunCount: runCount });
			openForkedSession(result, content);
		},
		[forkSession, openForkedSession],
	);

	const visibleHistorySession =
		historySession?.sessionId &&
		historySession.sessionId === dismissedHistorySessionId
			? undefined
			: historySession;
	const hideDeletedSessionUi = Boolean(
		dismissedHistorySessionId &&
			(sessionId === dismissedHistorySessionId ||
				historySession?.sessionId === dismissedHistorySessionId),
	);
	const activeSessionToDelete = hideDeletedSessionUi
		? null
		: (sessionId ?? visibleHistorySession?.sessionId ?? null);
	const handoffDeleteLocked = Boolean(
		handoffProgress || handoffOwnershipPending,
	);

	const requestDeleteSession = useCallback(() => {
		if (!activeSessionToDelete || deletingSession || handoffDeleteLocked) {
			return;
		}
		setDeleteConfirmOpen(true);
	}, [activeSessionToDelete, deletingSession, handoffDeleteLocked]);

	const handleDeleteSession = useCallback(async () => {
		if (!activeSessionToDelete || deletingSession) {
			return;
		}
		setDeletingSession(true);
		try {
			const deleted = await desktopClient.invoke<boolean>(
				"delete_chat_session",
				{
					sessionId: activeSessionToDelete,
					environmentId,
				},
			);
			if (!deleted) {
				toast({
					variant: "destructive",
					title: "Delete failed",
					description: "The session could not be removed from local history.",
				});
				return;
			}
			setDismissedHistorySessionId(activeSessionToDelete);
			setManualTitle("");
			hydratedSessionRef.current = null;
			manualTitleSessionRef.current = null;
			window.dispatchEvent(
				new CustomEvent("cline:session-deleted", {
					detail: {
						sessionId: activeSessionToDelete,
						environmentId,
					},
				}),
			);
			onDeleteSession?.(activeSessionToDelete, threadId);
			setPromptInput("");
			setPendingAttachments([]);
			setShowDiffView(false);
			void reset();
		} catch (error) {
			const description =
				error instanceof Error
					? error.message
					: "The session could not be removed from local history.";
			toast({
				variant: "destructive",
				title: "Delete failed",
				description,
			});
		} finally {
			setDeleteConfirmOpen(false);
			setDeletingSession(false);
		}
	}, [
		activeSessionToDelete,
		deletingSession,
		environmentId,
		onDeleteSession,
		reset,
		threadId,
		setPendingAttachments,
		setPromptInput,
	]);

	const handleExecutionTargetChange = useCallback(
		(target: "local" | "cloud") => {
			if (target === "cloud" && !cloudAgentsEnabled) {
				return;
			}
			setConfig((prev) => {
				if (target === prev.executionTarget) return prev;
				if (target === "cloud") {
					localConfigRef.current = {
						provider: prev.provider,
						model: prev.model,
						apiKey: prev.apiKey,
						workspaceRoot: prev.workspaceRoot,
						cwd: prev.cwd,
					};
					return {
						...prev,
						executionTarget: "cloud",
						provider: "cline",
						model:
							prev.provider === "cline" ? prev.model : CLINE_DEFAULT_MODEL_ID,
						apiKey: providerCredentials.cline?.apiKey ?? "",
						workspaceRoot: "",
						cwd: "",
					};
				}
				return {
					...prev,
					...localConfigRef.current,
					executionTarget: "local",
					repoUrl: undefined,
					branch: undefined,
				};
			});
			if (target === "cloud") {
				setPendingAttachments([]);
				setShowDiffView(false);
			}
		},
		[
			providerCredentials.cline?.apiKey,
			setConfig,
			cloudAgentsEnabled,
			setPendingAttachments,
		],
	);

	// Reset only new composers when the flag turns off; existing sessions attach.
	useEffect(() => {
		if (
			!cloudAgentsEnabled &&
			config.executionTarget === "cloud" &&
			!historySession &&
			!sessionId
		) {
			handleExecutionTargetChange("local");
		}
	}, [
		cloudAgentsEnabled,
		config.executionTarget,
		historySession,
		handleExecutionTargetChange,
		sessionId,
	]);

	const handleCloudRepoUrlChange = useCallback(
		(repoUrl: string) => {
			setConfig((prev) =>
				prev.repoUrl === repoUrl ? prev : { ...prev, repoUrl },
			);
		},
		[setConfig],
	);

	const handleCloudBranchChange = useCallback(
		(branch: string) => {
			setConfig((prev) =>
				prev.branch === branch ? prev : { ...prev, branch },
			);
		},
		[setConfig],
	);

	const attachmentList = useMemo(
		() =>
			pendingAttachments.map((file, index) => ({
				id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
				name: file.name,
				isImage: imageAttachmentMediaType(file) !== undefined,
			})),
		[pendingAttachments],
	);
	const handleRemoveAttachment = useCallback(
		(id: string) => {
			setPendingAttachments((prev) =>
				prev.filter((file, index) => {
					const fileId = `${file.name}:${file.size}:${file.lastModified}:${index}`;
					return fileId !== id;
				}),
			);
		},
		[setPendingAttachments],
	);
	const handleAbort = useCallback(() => {
		void abort();
	}, [abort]);
	const handleModelChange = useCallback(
		(nextModel: string) =>
			setConfig((prev) =>
				prev.model === nextModel ? prev : { ...prev, model: nextModel },
			),
		[setConfig],
	);
	const handleModeToggle = useCallback(
		() =>
			setConfig((prev) => ({
				...prev,
				mode: prev.mode === "plan" ? "act" : "plan",
			})),
		[setConfig],
	);
	const handleProviderChange = useCallback(
		(nextProvider: string) =>
			setConfig((prev) => {
				const selected = providerCredentials[nextProvider];
				const nextApiKey = selected?.apiKey ?? "";
				if (prev.provider === nextProvider && prev.apiKey === nextApiKey) {
					return prev;
				}
				return {
					...prev,
					provider: nextProvider,
					apiKey: nextApiKey,
				};
			}),
		[providerCredentials, setConfig],
	);
	const handleSendPrompt = useCallback(
		(prompt: string) => void handleSend(prompt),
		[handleSend],
	);
	const handleOpenHandoffCloud = useCallback(async () => {
		const receipt = handoffReceipt;
		if (!receipt) {
			return;
		}
		if (cloudAgentsEnabled) {
			const retryDraft =
				handoffUi && "retryDraft" in handoffUi
					? handoffUi.retryDraft
					: undefined;
			const retryAttachments =
				handoffUi && "retryAttachments" in handoffUi
					? handoffUi.retryAttachments
					: undefined;
			const opened = await Promise.resolve(
				onOpenSessionById?.(receipt.targetSessionId, {
					silent: true,
					initialPromptDraft: retryDraft,
					initialAttachments: retryAttachments,
				}),
			).catch(() => false);
			if (opened) {
				if (sourceSessionId && (retryDraft || retryAttachments?.length)) {
					onHandoffUiAction({ type: "retry_delivered", sourceSessionId });
				}
				return;
			}
			if (sourceSessionId) {
				onHandoffUiAction({ type: "external", sourceSessionId });
			}
		}
		await openExternalUrl(receipt.dashboardUrl).catch(() =>
			toast({
				title: "Unable to open the browser",
				description: "Copy the recovery link and open it manually.",
				variant: "destructive",
			}),
		);
	}, [
		cloudAgentsEnabled,
		handoffReceipt,
		handoffUi,
		onHandoffUiAction,
		onOpenSessionById,
		sourceSessionId,
	]);
	const handleOpenHandoffProgressLink = useCallback(() => {
		const dashboardUrl = handoffProgress?.dashboardUrl ?? handoffRecoveryUrl;
		if (dashboardUrl) {
			void openExternalUrl(dashboardUrl).catch(() =>
				toast({
					title: "Unable to open the browser",
					description: "Copy the link shown above and open it manually.",
					variant: "destructive",
				}),
			);
		}
	}, [handoffProgress?.dashboardUrl, handoffRecoveryUrl]);
	const handleDismissHandoffRecovery = useCallback(() => {
		if (!sourceSessionId || !handoffRecoveryUrl) return;
		onHandoffUiAction({
			type: "dismiss_recovery",
			sourceSessionId,
			dashboardUrl: handoffRecoveryUrl,
		});
	}, [handoffRecoveryUrl, onHandoffUiAction, sourceSessionId]);

	const firstUserMessage = messages.find(
		(message) => message.role === "user",
	)?.content;
	const metadataTitle =
		manualTitle || getSessionMetadataTitle(visibleHistorySession?.metadata);
	const threadTitle = toThreadTitle({
		title: hideDeletedSessionUi ? undefined : metadataTitle,
		prompt: hideDeletedSessionUi
			? undefined
			: (visibleHistorySession?.prompt ?? firstUserMessage),
	});
	const hasDiffChanges = summary.additions + summary.deletions > 0;
	const headerDiff = useMemo(
		() => ({
			additions: summary.additions,
			deletions: summary.deletions,
		}),
		[summary.additions, summary.deletions],
	);
	const handleOpenDiff = useCallback(() => {
		if (summary.additions + summary.deletions > 0) {
			setShowDiffView(true);
		}
	}, [summary.additions, summary.deletions]);

	const activeSessionForTitle = hideDeletedSessionUi
		? null
		: (sessionId ?? visibleHistorySession?.sessionId ?? null);
	const displayedMessages = hideDeletedSessionUi
		? []
		: appendPendingHandoffPrompt(messages, sourceSessionId, handoffUi);
	useEffect(() => {
		if (sourceSessionId && pendingHandoffPromptCaughtUp(messages, handoffUi)) {
			onHandoffUiAction({
				type: "prompt_reconciled",
				sourceSessionId,
			});
		}
	}, [handoffUi, messages, onHandoffUiAction, sourceSessionId]);
	const displayedError = hideDeletedSessionUi ? null : error;
	const cloudSessionError = isCloudSession
		? parseCloudSessionError(displayedError)
		: null;
	const importedFromTool = readImportedFromTool(
		visibleHistorySession?.metadata,
	);
	const displayedStatus = hideDeletedSessionUi ? "idle" : status;
	const displayedSessionId = hideDeletedSessionUi ? null : sessionId;
	const displayedIsSwitching = hideDeletedSessionUi
		? false
		: isHydratingSession;
	// Existing empty sessions are loading or empty, never a fresh prompt.
	const isWelcomeState =
		displayedMessages.length === 0 &&
		!displayedIsSwitching &&
		!displayedError &&
		!isProvisioningCloudSession &&
		!historySession;
	const isSessionActive =
		displayedStatus === "starting" ||
		displayedStatus === "running" ||
		displayedStatus === "stopping";
	const derivedAgentActivity = useMemo(
		() =>
			buildSessionAgentActivity(displayedMessages, {
				sessionActive: isSessionActive,
			}),
		[displayedMessages, isSessionActive],
	);
	// The roster is read for every displayed session, not gated on the tally
	// above: that tally only sees the newest messages, so gating on it would hide
	// the agents of exactly the long sessions this is most useful for. Opening the
	// panel re-reads; polling is what the active check gates.
	const [agentPanelOpen, setAgentPanelOpen] = useState(false);
	const {
		agents,
		loading: agentsLoading,
		error: agentsError,
	} = useSessionAgents({
		environmentId,
		sessionId: isCloudSession ? null : displayedSessionId,
		panelOpen: agentPanelOpen,
		sessionActive: isSessionActive,
	});
	const agentActivity = useMemo(
		() =>
			mergeAgentActivity(agents, derivedAgentActivity, {
				sessionActive: isSessionActive,
			}),
		[agents, derivedAgentActivity, isSessionActive],
	);
	// A child agent has its own session row, so opening it goes through the same
	// path as any other session — it is just never listed in the sidebar.
	const onOpenAgentSession = useCallback(
		async (agentSessionId: string) => {
			await onOpenSessionById?.(agentSessionId, environmentId);
		},
		[environmentId, onOpenSessionById],
	);

	const handleRenameTitle = useCallback(
		async (nextTitle: string) => {
			if (!activeSessionForTitle || renamingSession) {
				return;
			}
			setRenamingSession(true);
			try {
				await desktopClient.invoke("update_chat_session_title", {
					sessionId: activeSessionForTitle,
					environmentId,
					title: nextTitle,
				});
				const normalizedTitle = nextTitle.trim();
				setManualTitle(normalizedTitle);
				onUpdateSessionMetadata?.(activeSessionForTitle, {
					...(historySession?.metadata ?? {}),
					title: normalizedTitle || undefined,
				});
				window.dispatchEvent(
					new CustomEvent("cline:session-title-updated", {
						detail: {
							sessionId: activeSessionForTitle,
							environmentId,
							title: normalizedTitle,
						},
					}),
				);
			} catch (error) {
				toast({
					title: "Rename failed",
					description: humanizeCloudSessionError(
						error instanceof Error ? error.message : String(error),
					),
					variant: "destructive",
				});
			} finally {
				setRenamingSession(false);
			}
		},
		[
			activeSessionForTitle,
			environmentId,
			historySession?.metadata,
			onUpdateSessionMetadata,
			renamingSession,
		],
	);

	useEffect(() => {
		if (!hasDiffChanges) {
			setShowDiffView(false);
		}
	}, [hasDiffChanges]);

	const resolvedWorkspaceRoot = config.workspaceRoot || config.cwd || "";
	const workspaceContextValue = useMemo(
		() => ({
			workspaceRoot: resolvedWorkspaceRoot,
			workspaces,
			listWorkspaces,
			refreshWorkspaces,
			switchWorkspace,
			pickWorkspaceDirectory,
			selectChat,
		}),
		[
			resolvedWorkspaceRoot,
			workspaces,
			listWorkspaces,
			refreshWorkspaces,
			switchWorkspace,
			pickWorkspaceDirectory,
			selectChat,
		],
	);

	const isAppReady =
		chatTransportState === "connected" && providersLoaded && workspacesLoaded;

	if (!isAppReady) {
		return (
			<div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-background text-foreground">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
				<p className="text-sm text-muted-foreground">
					{chatTransportState === "unavailable"
						? "Desktop backend unavailable"
						: chatTransportState !== "connected"
							? "Connecting..."
							: "Loading..."}
				</p>
				{chatTransportError ? (
					<p className="max-w-xl px-6 text-center text-xs text-muted-foreground">
						{chatTransportError}
					</p>
				) : null}
			</div>
		);
	}

	const chatComposer = (
		<ChatInputBar
			readOnly={isCloudSessionExpired}
			attachments={attachmentList}
			cloudHandoffAvailable={cloudHandoffAvailable || handoffRetryEligible}
			environmentId={environmentId}
			hasRunningAgents={agentActivity.running > 0}
			onAbort={handleAbort}
			onAttachFiles={handleAttachFiles}
			onListGitBranches={listGitBranches}
			onRemoveAttachment={handleRemoveAttachment}
			onSwitchGitBranch={switchGitBranch}
			onModelChange={handleModelChange}
			onModeToggle={handleModeToggle}
			onPromptInputChange={handlePromptInputChange}
			onOpenModelSettings={onOpenModelSettings}
			onReasoningChange={handleReasoningChange}
			onSteerPromptInQueue={steerPromptInQueue}
			onEditPromptInQueue={updatePromptInQueue}
			onRemovePromptInQueue={handleRemoveQueuedPrompt}
			onProviderChange={handleProviderChange}
			onSend={handleSendPrompt}
			gitBranch={gitBranch}
			cloudBranch={config.branch}
			executionTarget={isCloudSession ? "cloud" : "local"}
			hasActiveSession={Boolean(sessionId)}
			repoUrl={config.repoUrl}
			model={config.model}
			modelContextWindow={modelContextWindow}
			mode={config.mode}
			promptsInQueue={promptsInQueue}
			promptDraft={promptDraft}
			provider={config.provider}
			reasoningEffort={config.reasoningEffort}
			status={status}
			summary={summary}
			thinking={config.thinking}
			variant={isWelcomeState ? "welcome" : "conversation"}
		/>
	);
	const composer = handoffReceipt ? (
		<CloudHandoffReceipt
			onForkLocally={() => void handleForkSession()}
			onOpenCloud={() => void handleOpenHandoffCloud()}
			receipt={handoffReceipt}
			showRecoveryUrl={handoffExternalPresentation || !cloudAgentsEnabled}
		/>
	) : handoffProgress ? (
		<CloudHandoffProgress
			dashboardUrl={
				cloudAgentsEnabled ? undefined : handoffProgress.dashboardUrl
			}
			message={handoffProgress.message}
			onOpenCloud={handleOpenHandoffProgressLink}
			phase={handoffProgress.phase}
		/>
	) : handoffRecoveryUrl ? (
		<div className="w-full">
			<CloudHandoffRecoveryNotice
				dashboardUrl={handoffRecoveryUrl}
				onDismiss={handleDismissHandoffRecovery}
				onOpenCloud={handleOpenHandoffProgressLink}
			/>
			{chatComposer}
		</div>
	) : (
		chatComposer
	);

	const cloudConnectUrl =
		cloudSessionError?.code === "github_not_connected"
			? cloudSessionError.connectUrl
			: undefined;

	return (
		<WorkspaceProvider value={workspaceContextValue}>
			{/* Requires `dragDropEnabled: false` on the Tauri window so the native shell does not swallow OS file drags. */}
			<AttachmentDropZone
				className={
					isWelcomeState
						? "grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden"
						: "grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
				}
				disabled={isCloudSessionExpired}
				description={
					isCloudSession
						? "Images will be added to your next message"
						: undefined
				}
				onAttachFiles={handleAttachFiles}
			>
				{!isWelcomeState ? (
					<WindowTitleBarContent>
						<div className="cline-view-enter z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
							<AgentHeader
								agentActivity={isCloudSession ? undefined : agentActivity}
								agents={isCloudSession ? undefined : agents}
								agentsError={agentsError}
								agentsLoading={agentsLoading}
								onAgentsOpenChange={setAgentPanelOpen}
								onOpenAgentSession={onOpenAgentSession}
								onOpenParentSession={onOpenAgentSession}
								parentSession={hideDeletedSessionUi ? undefined : parentSession}
								canEditTitle={
									Boolean(activeSessionForTitle) && !isProvisioningCloudSession
								}
								canDeleteSession={
									Boolean(activeSessionToDelete) && !handoffDeleteLocked
								}
								deletingSession={deletingSession}
								diff={isCloudSession ? undefined : headerDiff}
								onDeleteSession={requestDeleteSession}
								onNewThread={onNewThread}
								onOpenDiff={handleOpenDiff}
								onRenameTitle={handleRenameTitle}
								renamingTitle={renamingSession}
								status={headerStatus}
								title={threadTitle}
							/>
						</div>
					</WindowTitleBarContent>
				) : null}
				<WelcomeScreen
					active={isWelcomeState}
					body={
						isCloudSession &&
						displayedIsSwitching &&
						displayedMessages.length === 0 ? (
							// Keep opening an existing cloud session visually continuous.
							<CloudProvisioningPane phase="Opening session..." />
						) : showDiffView && !isCloudSession ? (
							<DiffView
								cwd={config.cwd || config.workspaceRoot}
								environmentId={environmentId}
								fileDiffs={fileDiffs}
								onClose={() => setShowDiffView(false)}
							/>
						) : (
							<ChatMessages
								onAnswerAskQuestion={handleAnswerAskQuestion}
								onApproveToolApproval={handleApproveToolApproval}
								onRejectToolApproval={handleRejectToolApproval}
								chatTransportState={chatTransportState}
								activityLabel={activityLabel}
								error={cloudSessionError?.message ?? displayedError}
								errorAction={
									cloudConnectUrl
										? {
												label: "Connect GitHub",
												onClick: () => openGitHubConnect(cloudConnectUrl),
											}
										: undefined
								}
								importedFromTool={importedFromTool}
								messages={displayedMessages}
								onEditMessage={isCloudSession ? undefined : handleEditMessage}
								onRestoreCheckpoint={
									isCloudSession || handoffReceipt
										? undefined
										: handleRestoreCheckpoint
								}
								onForkSession={isCloudSession ? undefined : handleForkSession}
								onProceedWhileRunning={
									isCloudSession ? undefined : proceedWhileRunning
								}
								startingLabel={
									isProvisioningCloudSession
										? provisioningPhase
										: isCloudSession && !displayedSessionId
											? provisioningPhase
											: undefined
								}
								onFixCredentials={handleFixCredentials}
								pendingToolApprovals={pendingToolApprovals}
								pendingAskQuestions={pendingAskQuestions}
								sessionId={displayedSessionId}
								streamingMessageId={activeAssistantMessageId}
								isSessionSwitching={displayedIsSwitching}
								status={
									isProvisioningCloudSession ? "starting" : displayedStatus
								}
							/>
						)
					}
					composer={composer}
					environmentSelector={
						<EnvironmentSelector
							activeEnvironmentId={environmentId}
							cloudEnabled={cloudAgentsEnabled}
							executionTarget={isCloudSession ? "cloud" : "local"}
							onSelectExecutionTarget={handleExecutionTargetChange}
							loading={environmentProfilesLoading}
							onAddSshHost={onAddSshHost}
							onSelectEnvironment={onSelectEnvironment}
							profiles={environmentProfiles}
						/>
					}
					gitBranch={gitBranch}
					notice={
						providersLoaded &&
						hasConnectedProvider === false &&
						onOpenSetup &&
						onOpenModelSettings ? (
							<WelcomeSetupNotice
								onOpenModelSettings={onOpenModelSettings}
								onOpenSetup={onOpenSetup}
							/>
						) : undefined
					}
					onListGitBranches={listGitBranches}
					onOpenSession={onOpenSessionById}
					onSwitchGitBranch={switchGitBranch}
					executionTarget={isCloudSession ? "cloud" : "local"}
					repoUrl={config.repoUrl ?? ""}
					cloudBranch={config.branch ?? ""}
					onRepoUrlChange={handleCloudRepoUrlChange}
					onCloudBranchChange={handleCloudBranchChange}
					cloudAgentsEnabled={cloudAgentsEnabled}
					onWorkInChange={canWorkInWorktree ? setWorkIn : undefined}
					workIn={workIn}
				/>
			</AttachmentDropZone>
			<AlertDialog
				open={deleteConfirmOpen}
				onOpenChange={(open) => {
					if (deletingSession) {
						return;
					}
					setDeleteConfirmOpen(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Session?</AlertDialogTitle>
						<AlertDialogDescription>
							{isCloudSession
								? "This cloud session and its workspace will be deleted."
								: "This session will be removed from local history."}
							{!isCloudSession &&
							isTaskWorktreePath(config.workspaceRoot || config.cwd || "")
								? ` ${TASK_WORKTREE_DELETE_WARNING}`
								: null}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletingSession}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deletingSession}
							onClick={() => void handleDeleteSession()}
						>
							{deletingSession ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</WorkspaceProvider>
	);
}
