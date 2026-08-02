"use client";

import { ImagePlus } from "lucide-react";
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
import { ChatInputBar } from "@/components/views/chat/chat-input-bar";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import { DiffView } from "@/components/views/chat/diff-view";
import { WelcomeScreen } from "@/components/views/chat/welcome-chat";
import { OnboardingView } from "@/components/views/onboarding/onboarding-view";
import { SessionsView } from "@/components/views/sessions/sessions-view";
import {
	type SettingsSection,
	SettingsView,
} from "@/components/views/settings/settings-view";
import { AccountProvider } from "@/contexts/account-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useChatSession } from "@/hooks/use-chat-session";
import { useSessionAgents } from "@/hooks/use-session-agents";
import { useSessionHistory } from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import { syncAppIcon } from "@/lib/app-icon";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import {
	createDesktopAppState,
	type DesktopAppLocation,
	type DesktopAppView,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import { desktopClient } from "@/lib/desktop-client";
import {
	subscribeToDesktopMenuActions,
	watchDesktopTrayStatus,
} from "@/lib/desktop-tray";
import { syncDesktopWindowTitle } from "@/lib/desktop-window-title";
import { createLatestSuccessfulRequestGate } from "@/lib/latest-successful-request";
import {
	hasCompletedOnboarding,
	markOnboardingCompleted,
	ONBOARDING_RESET_EVENT,
} from "@/lib/onboarding";
import { fetchProviderCatalog } from "@/lib/provider-model-catalog";
import {
	buildSessionAgentActivity,
	mergeAgentActivity,
} from "@/lib/session-agents";
import {
	getSessionMetadataTitle,
	type SessionHistoryItem,
	type SessionMetadata,
} from "@/lib/session-history";
import { syncHubAccent, syncHubTheme, watchSystemHubTheme } from "@/lib/theme";
import {
	filterWorkspacePaths,
	mergeWorkspacePaths,
	normalizeWorkspacePath,
	readWorkspaceSelectionFromWindow,
	workspacePathsFromSessions,
	writeWorkspaceSelectionToWindow,
} from "@/lib/workspace-paths";

function makeThreadId(): string {
	return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const GIT_BRANCH_REFRESH_INTERVAL_MS = 5_000;

type AppLocation = DesktopAppLocation<SettingsSection>;

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
		(threadId) => createDesktopAppState(threadId, "General"),
	);
	// Starts false on both server and first client render (hydration-safe);
	// the effect below reads the persisted state right after mount.
	const [showOnboarding, setShowOnboarding] = useState(false);
	const { navigation, threads } = appState;
	const { activeThreadId, settingsSection, view } = navigation.current;

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
		return watchSystemHubTheme();
	}, []);

	useEffect(() => {
		// The dock reverts to the bundled icon every launch; re-apply the
		// user's choice once the shell is up.
		void syncAppIcon();
	}, []);

	useEffect(() => {
		void syncDesktopWindowTitle();
	}, []);

	useEffect(() => watchDesktopTrayStatus(), []);

	const handleNewThread = useCallback(() => {
		dispatchApp({ type: "new-thread", threadId: makeThreadId() });
	}, []);

	const completeOnboarding = useCallback(() => {
		markOnboardingCompleted();
		setShowOnboarding(false);
		// A fresh thread remounts the chat pane so it picks up credentials and
		// the provider/model selection configured during onboarding.
		handleNewThread();
	}, [handleNewThread]);

	const handleOpenSession = useCallback(
		(session: SessionHistoryItem, initialPromptDraft?: string) => {
			dispatchApp({ type: "open-session", session, initialPromptDraft });
		},
		[],
	);

	const handleDeleteSession = useCallback(
		(deletedSessionId: string, deletedThreadId?: string) => {
			dispatchApp({
				type: "delete-session",
				deletedSessionId,
				deletedThreadId,
				fallbackThreadId: makeThreadId(),
			});
		},
		[],
	);

	const handleUpdateSessionMetadata = useCallback(
		(sessionId: string, metadata: SessionMetadata) => {
			dispatchApp({ type: "update-session-metadata", sessionId, metadata });
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
			handleDeleteSession(sessionId);
		});
	}, [handleDeleteSession]);

	const activeHistorySessionId =
		threads.find((thread) => thread.id === activeThreadId)?.historySession
			?.sessionId ?? null;
	const activeThread =
		threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
	const handleHome = useCallback(() => {
		if (activeThread?.historySession || activeThread?.hasStarted) {
			handleNewThread();
			return;
		}
		navigateWith({ view: "chat" });
	}, [activeThread, handleNewThread, navigateWith]);
	const handleViewChange = useCallback(
		(nextView: DesktopAppView) => {
			navigateWith({ view: nextView });
		},
		[navigateWith],
	);
	const handleSettingsSectionChange = useCallback(
		(section: SettingsSection) => {
			navigateWith({ settingsSection: section, view: "settings" });
		},
		[navigateWith],
	);
	useEffect(
		() =>
			subscribeToDesktopMenuActions((action) => {
				switch (action) {
					case "new-session":
						handleNewThread();
						break;
					case "open-settings":
						handleViewChange("settings");
						break;
				}
			}),
		[handleNewThread, handleViewChange],
	);
	const handleThreadStarted = useCallback((threadId: string) => {
		dispatchApp({ type: "thread-started", threadId });
	}, []);
	const handleInitialPromptDraftConsumed = useCallback((threadId: string) => {
		dispatchApp({ type: "consume-initial-prompt-draft", threadId });
	}, []);
	const sessionHistory = useSessionHistory({
		activeSessionId: activeHistorySessionId,
		onDeleteSession: handleDeleteSession,
		onOpenSession: handleOpenSession,
		onUpdateSessionMetadata: handleUpdateSessionMetadata,
	});
	const handleOpenSessionById = useCallback(
		async (sessionId: string) => {
			const cachedSession = sessionHistory.sessions.find(
				(session) => session.sessionId === sessionId,
			);
			if (cachedSession) {
				handleOpenSession(cachedSession);
				return;
			}
			try {
				const session = await desktopClient.invoke<SessionHistoryItem | null>(
					"get_discovered_session",
					{ session_id: sessionId },
				);
				if (!session) {
					throw new Error("The session for this run is no longer available.");
				}
				handleOpenSession(session);
			} catch (error) {
				toast({
					title: "Unable to open run",
					description: error instanceof Error ? error.message : String(error),
					variant: "destructive",
				});
			}
		},
		[handleOpenSession, sessionHistory.sessions],
	);
	const historyWorkspacePaths = useMemo(
		() => workspacePathsFromSessions(sessionHistory.sessions),
		[sessionHistory.sessions],
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
			(thread) => thread.id === parentSessionId,
		)?.title;
		return { sessionId: parentSessionId, title };
	}, [activeThread?.historySession?.parentSessionId, sessionHistory.threads]);

	return (
		<AccountProvider>
			<SidebarProvider>
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
							onHome={handleHome}
							onNavigateBack={handleNavigateBack}
							onNavigateForward={handleNavigateForward}
							onNewThread={handleNewThread}
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
									key={activeThread.id}
									historySession={activeThread.historySession}
									initialPromptDraft={activeThread.initialPromptDraft}
									knownWorkspacePaths={historyWorkspacePaths}
									onInitialPromptDraftConsumed={
										handleInitialPromptDraftConsumed
									}
									onUpdateSessionMetadata={handleUpdateSessionMetadata}
									threadId={activeThread.id}
									onDeleteSession={handleDeleteSession}
									onNewThread={handleNewThread}
									onOpenSession={handleOpenSession}
									onOpenSessionById={handleOpenSessionById}
									parentSession={activeParentSession}
									onThreadStarted={handleThreadStarted}
								/>
							</div>
						) : null}
						{view === "settings" ? (
							<div className="absolute inset-0 z-30 bg-background text-foreground">
								<SettingsView
									onNavigateSection={handleSettingsSectionChange}
									onOpenSession={handleOpenSessionById}
									section={settingsSection}
								/>
							</div>
						) : null}
					</SidebarInset>
				</div>
			</SidebarProvider>
			{showOnboarding ? (
				<div className="fixed inset-0 z-50">
					<OnboardingView onComplete={completeOnboarding} />
				</div>
			) : null}
		</AccountProvider>
	);
}

function ChatThreadPane({
	threadId,
	historySession,
	initialPromptDraft,
	knownWorkspacePaths,
	onInitialPromptDraftConsumed,
	onUpdateSessionMetadata,
	onDeleteSession,
	onNewThread,
	onOpenSession,
	onOpenSessionById,
	parentSession,
	onThreadStarted,
}: {
	threadId: string;
	historySession?: SessionHistoryItem;
	initialPromptDraft?: string;
	knownWorkspacePaths: string[];
	onInitialPromptDraftConsumed?: (threadId: string) => void;
	onUpdateSessionMetadata?: (
		sessionId: string,
		metadata: SessionMetadata,
	) => void;
	onDeleteSession?: (sessionId: string, threadId?: string) => void;
	onNewThread?: () => void;
	onOpenSession?: (
		session: SessionHistoryItem,
		initialPromptDraft?: string,
	) => void;
	onOpenSessionById?: (sessionId: string) => void | Promise<void>;
	parentSession?: { sessionId: string; title?: string };
	onThreadStarted?: (threadId: string) => void;
}) {
	const {
		sessionId,
		status,
		chatTransportState,
		chatTransportError,
		isHydratingSession,
		activeAssistantMessageId,
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
		reset,
		abort,
		hydrateSession,
	} = useChatSession();
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
	const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
	const [isDraggingFiles, setIsDraggingFiles] = useState(false);
	const dragDepthRef = useRef(0);
	const [showDiffView, setShowDiffView] = useState(false);
	const [deletingSession, setDeletingSession] = useState(false);
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [renamingSession, setRenamingSession] = useState(false);
	const [manualTitle, setManualTitle] = useState("");
	const [dismissedHistorySessionId, setDismissedHistorySessionId] = useState<
		string | null
	>(null);
	const [gitBranch, setGitBranch] = useState("no-git");
	const [providerCredentials, setProviderCredentials] = useState<
		Record<string, { apiKey: string }>
	>({});
	const [providersLoaded, setProvidersLoaded] = useState(false);
	// History paths lead each merge: they are ordered by session recency, so
	// stored or stale entries only append after them.
	const [workspaces, setWorkspaces] = useState<string[]>(() =>
		filterWorkspacePaths(
			mergeWorkspacePaths(
				knownWorkspacePaths,
				readWorkspaceSelectionFromWindow().workspaces,
			),
		),
	);
	const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
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
	const activeWorkspaceCwd = (config.cwd || config.workspaceRoot || "").trim();

	useEffect(() => {
		setWorkspaces((current) => {
			const merged = filterWorkspacePaths(
				mergeWorkspacePaths(knownWorkspacePaths, current),
			);
			return current.length === merged.length &&
				current.every((workspace, index) => workspace === merged[index])
				? current
				: merged;
		});
	}, [knownWorkspacePaths]);

	useEffect(() => {
		const lastWorkspace = (config.workspaceRoot || config.cwd || "").trim();
		writeWorkspaceSelectionToWindow({
			lastWorkspace,
			workspaces: mergeWorkspacePaths(workspaces, [lastWorkspace]),
		});
	}, [config.cwd, config.workspaceRoot, workspaces]);

	useEffect(() => {
		let cancelled = false;

		async function loadProviderCredentials() {
			try {
				const payload = await fetchProviderCatalog();
				if (cancelled) {
					return;
				}
				const next: Record<string, { apiKey: string }> = {};
				for (const provider of payload.providers ?? []) {
					const id = provider.id?.trim();
					if (!id) {
						continue;
					}
					next[id] = {
						apiKey: provider.apiKey?.trim() ?? "",
					};
				}
				setProviderCredentials(next);
			} catch {
				// Keep current config if provider catalog cannot be read.
			} finally {
				if (!cancelled) setProvidersLoaded(true);
			}
		}

		void loadProviderCredentials();
		return () => {
			cancelled = true;
		};
	}, []);

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
			const payload = await desktopClient.invoke<{ branch?: string }>(
				"get_git_branch",
				{ cwd },
			);
			if (!gitBranchRequestGateRef.current.commit(requestId)) {
				return;
			}
			const branch = payload?.branch?.trim();
			setGitBranch(branch && branch.length > 0 ? branch : "no-git");
		} catch {
			// Preserve the latest successful branch through transient failures.
		}
	}, [getWorkspaceCwd]);

	const invalidateGitBranch = useCallback(() => {
		gitBranchRequestGateRef.current.invalidate();
		setGitBranch("no-git");
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
				current?: string;
				branches?: string[];
			}>("list_git_branches", { cwd });
			const current = payload?.current?.trim() || "no-git";
			const branches = Array.isArray(payload?.branches)
				? payload.branches.filter((item) => item.trim().length > 0)
				: [];
			return { current, branches };
		} catch {
			return { current: "no-git", branches: [] };
		}
	}, [getWorkspaceCwd]);

	const switchGitBranch = useCallback(
		async (nextBranch: string): Promise<boolean> => {
			const cwd = getWorkspaceCwd();
			if (!cwd) {
				return false;
			}
			try {
				await desktopClient.invoke<{ branch?: string }>("checkout_git_branch", {
					cwd,
					branch: nextBranch,
				});
				invalidateGitBranch();
				await refreshGitBranch();
				return true;
			} catch {
				return false;
			}
		},
		[getWorkspaceCwd, invalidateGitBranch, refreshGitBranch],
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
				mergeWorkspacePaths(knownWorkspacePaths, [preferred, current]),
			);
		},
		[knownWorkspacePaths],
	);

	const refreshWorkspaces = useCallback(
		async (preferredWorkspace?: string) => {
			try {
				const results = await listWorkspaces(preferredWorkspace);
				setWorkspaces((current) => {
					const merged = mergeWorkspacePaths(results, current);
					return current.length === merged.length &&
						current.every((workspace, index) => workspace === merged[index])
						? current
						: merged;
				});
			} finally {
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
				.invoke<{ valid?: boolean }>("validate_workspace_directory", {
					path: nextWorkspace,
				})
				.catch(() => ({ valid: false }));
			if (validation.valid !== true) {
				return false;
			}
			if (requestId !== workspaceSelectionRequestRef.current) {
				return false;
			}

			invalidateGitBranch();
			setWorkspacePath(nextWorkspace);
			setWorkspaces((prev) =>
				filterWorkspacePaths(mergeWorkspacePaths(prev, [nextWorkspace])),
			);

			// Refresh the merged history, stored, and current workspace catalog.
			void refreshWorkspaces(nextWorkspace);

			return true;
		},
		[invalidateGitBranch, refreshWorkspaces, setWorkspacePath],
	);

	const selectChat = useCallback(async (): Promise<boolean> => {
		workspaceSelectionRequestRef.current += 1;
		invalidateGitBranch();
		setWorkspacePath("");
		return true;
	}, [invalidateGitBranch, setWorkspacePath]);

	const pickWorkspaceDirectory = useCallback(
		async (initialPath?: string): Promise<string | null> => {
			try {
				const selected = await desktopClient.invoke<string | null>(
					"pick_workspace_directory",
					{
						initialPath: initialPath?.trim() || undefined,
					},
				);
				if (typeof selected !== "string") {
					return null;
				}
				const trimmed = selected.trim();
				return trimmed.length > 0 ? trimmed : null;
			} catch {
				return null;
			}
		},
		[],
	);

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
	}, [historySession, manualTitle, reset, threadId, setPromptInput]);

	useEffect(() => {
		if (!historySession) {
			return;
		}
		if (hydratedSessionRef.current === historySession.sessionId) {
			return;
		}
		hydratedSessionRef.current = historySession.sessionId;
		setPromptInput(initialPromptDraft ?? "");
		if (initialPromptDraft !== undefined) {
			onInitialPromptDraftConsumed?.(threadId);
		}
		setPendingAttachments([]);
		setManualTitle(getSessionMetadataTitle(historySession.metadata));
		void hydrateSession(historySession);
	}, [
		historySession,
		hydrateSession,
		initialPromptDraft,
		onInitialPromptDraftConsumed,
		setPromptInput,
		threadId,
	]);

	const handleSend = useCallback(
		async (prompt: string) => {
			const trimmed = prompt.trim();
			if (!trimmed && pendingAttachments.length === 0) {
				return;
			}
			onThreadStarted?.(threadId);
			// Also clear the injected draft: the composer cleared its local copy,
			// but a stale non-empty draft would repopulate the input if the
			// composer remounts (e.g. a transport blip re-showing the loader).
			setPromptInput("");
			const toSend = [...pendingAttachments];
			setPendingAttachments([]);
			await sendPrompt(trimmed, toSend);
		},
		[onThreadStarted, pendingAttachments, sendPrompt, setPromptInput, threadId],
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

	const requestDeleteSession = useCallback(() => {
		if (!activeSessionToDelete || deletingSession) {
			return;
		}
		setDeleteConfirmOpen(true);
	}, [activeSessionToDelete, deletingSession]);

	const handleDeleteSession = useCallback(async () => {
		if (!activeSessionToDelete || deletingSession) {
			return;
		}
		setDeletingSession(true);
		try {
			console.error(
				`[webview:delete] invoke delete_chat_session sessionId=${activeSessionToDelete}`,
			);
			const deleted = await desktopClient.invoke<boolean>(
				"delete_chat_session",
				{
					sessionId: activeSessionToDelete,
				},
			);
			console.error(
				`[webview:delete] invoke result sessionId=${activeSessionToDelete} deleted=${deleted}`,
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
					},
				}),
			);
			onDeleteSession?.(activeSessionToDelete, threadId);
			setPromptInput("");
			setPendingAttachments([]);
			setShowDiffView(false);
			void reset();
		} catch (error) {
			console.error(
				`[webview:delete] invoke error sessionId=${activeSessionToDelete} error=${error instanceof Error ? error.message : String(error)}`,
			);
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
		onDeleteSession,
		reset,
		threadId,
		setPromptInput,
	]);

	const handleAttachFiles = useCallback((files: File[]) => {
		setPendingAttachments((prev) => {
			const existing = new Set(
				prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
			);
			const next = [...prev];
			for (const file of files) {
				const key = `${file.name}:${file.size}:${file.lastModified}`;
				if (!existing.has(key)) {
					existing.add(key);
					next.push(file);
				}
			}
			return next;
		});
	}, []);

	// Drag-and-drop file attachments. Requires `dragDropEnabled: false` on the
	// Tauri window — otherwise the native shell swallows OS file drags and these
	// HTML5 events never fire.
	const handleDragEnter = useCallback((event: React.DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		dragDepthRef.current += 1;
		setIsDraggingFiles(true);
	}, []);

	const handleDragOver = useCallback((event: React.DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const handleDragLeave = useCallback((event: React.DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setIsDraggingFiles(false);
		}
	}, []);

	const handleDrop = useCallback(
		(event: React.DragEvent) => {
			if (!event.dataTransfer.types.includes("Files")) {
				return;
			}
			event.preventDefault();
			dragDepthRef.current = 0;
			setIsDraggingFiles(false);
			const files = Array.from(event.dataTransfer.files);
			if (files.length > 0) {
				handleAttachFiles(files);
			}
		},
		[handleAttachFiles],
	);

	const attachmentList = pendingAttachments.map((file, index) => ({
		id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
		name: file.name,
		isImage: file.type.startsWith("image/"),
	}));

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

	const activeSessionForTitle = hideDeletedSessionUi
		? null
		: (sessionId ?? visibleHistorySession?.sessionId ?? null);
	const displayedMessages = hideDeletedSessionUi ? [] : messages;
	const displayedError = hideDeletedSessionUi ? null : error;
	const displayedStatus = hideDeletedSessionUi ? "idle" : status;
	const displayedSessionId = hideDeletedSessionUi ? null : sessionId;
	const displayedIsSwitching = hideDeletedSessionUi
		? false
		: isHydratingSession;
	const isWelcomeState =
		displayedMessages.length === 0 && !displayedIsSwitching && !displayedError;
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
		sessionId: displayedSessionId,
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
		(agentSessionId: string) => onOpenSessionById?.(agentSessionId),
		[onOpenSessionById],
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
							title: normalizedTitle,
						},
					}),
				);
			} finally {
				setRenamingSession(false);
			}
		},
		[
			activeSessionForTitle,
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

	const composer = (
		<ChatInputBar
			attachments={attachmentList}
			onAbort={() => void abort()}
			onAttachFiles={handleAttachFiles}
			onListGitBranches={listGitBranches}
			onRemoveAttachment={(id) => {
				setPendingAttachments((prev) =>
					prev.filter((file, index) => {
						const fileId = `${file.name}:${file.size}:${file.lastModified}:${index}`;
						return fileId !== id;
					}),
				);
			}}
			onSwitchGitBranch={switchGitBranch}
			onModelChange={(nextModel) =>
				setConfig((prev) =>
					prev.model === nextModel ? prev : { ...prev, model: nextModel },
				)
			}
			onModeToggle={() =>
				setConfig((prev) => ({
					...prev,
					mode: prev.mode === "plan" ? "act" : "plan",
				}))
			}
			onPromptInputChange={handlePromptInputChange}
			onReasoningChange={handleReasoningChange}
			onSteerPromptInQueue={(promptId) => {
				void steerPromptInQueue(promptId);
			}}
			onEditPromptInQueue={(promptId, prompt) => {
				void updatePromptInQueue(promptId, prompt);
			}}
			onRemovePromptInQueue={handleRemoveQueuedPrompt}
			onProviderChange={(nextProvider) =>
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
				})
			}
			onSend={(prompt) => void handleSend(prompt)}
			gitBranch={gitBranch}
			model={config.model}
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

	return (
		<WorkspaceProvider value={workspaceContextValue}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Drag-and-drop target only; the paperclip button is the accessible attach path. */}
			<div
				className={
					isWelcomeState
						? "relative grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden"
						: "relative grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
				}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				{isDraggingFiles ? (
					<div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
						<div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-card px-10 py-8 shadow-lg">
							<ImagePlus className="h-8 w-8 text-primary" />
							<p className="text-sm font-medium text-foreground">
								Drop to attach
							</p>
							<p className="text-xs text-muted-foreground">
								Screenshots and files will be added to your next message
							</p>
						</div>
					</div>
				) : null}
				{!isWelcomeState ? (
					<div className="z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
						<AgentHeader
							agentActivity={agentActivity}
							agents={agents}
							agentsError={agentsError}
							agentsLoading={agentsLoading}
							onAgentsOpenChange={setAgentPanelOpen}
							onOpenAgentSession={onOpenAgentSession}
							onOpenParentSession={onOpenSessionById}
							parentSession={hideDeletedSessionUi ? undefined : parentSession}
							canEditTitle={Boolean(activeSessionForTitle)}
							canDeleteSession={Boolean(activeSessionToDelete)}
							deletingSession={deletingSession}
							diff={{
								additions: summary.additions,
								deletions: summary.deletions,
							}}
							onDeleteSession={requestDeleteSession}
							onNewThread={onNewThread}
							onOpenDiff={() => {
								if (hasDiffChanges) setShowDiffView(true);
							}}
							onRenameTitle={handleRenameTitle}
							renamingTitle={renamingSession}
							status={status}
							title={threadTitle}
						/>
					</div>
				) : null}
				<WelcomeScreen
					active={isWelcomeState}
					body={
						showDiffView ? (
							<DiffView
								cwd={config.cwd || config.workspaceRoot}
								fileDiffs={fileDiffs}
								onClose={() => setShowDiffView(false)}
							/>
						) : (
							<ChatMessages
								onAnswerAskQuestion={handleAnswerAskQuestion}
								onApproveToolApproval={handleApproveToolApproval}
								onRejectToolApproval={handleRejectToolApproval}
								chatTransportState={chatTransportState}
								error={displayedError}
								messages={displayedMessages}
								onEditMessage={handleEditMessage}
								onRestoreCheckpoint={handleRestoreCheckpoint}
								onForkSession={handleForkSession}
								pendingToolApprovals={pendingToolApprovals}
								pendingAskQuestions={pendingAskQuestions}
								sessionId={displayedSessionId}
								streamingMessageId={activeAssistantMessageId}
								isSessionSwitching={displayedIsSwitching}
								status={displayedStatus}
							/>
						)
					}
					composer={composer}
					gitBranch={gitBranch}
					onListGitBranches={listGitBranches}
					onStartChat={setPromptInput}
					onSwitchGitBranch={switchGitBranch}
					quickActions={[]}
				/>
			</div>
			<AlertDialog
				open={deleteConfirmOpen}
				onOpenChange={(open) => {
					if (deletingSession) {
						return;
					}
					if (!open) {
						console.error(
							`[webview:delete] cancelled sessionId=${activeSessionToDelete ?? "null"}`,
						);
					}
					setDeleteConfirmOpen(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Session?</AlertDialogTitle>
						<AlertDialogDescription>
							This session will be removed from local history.
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
