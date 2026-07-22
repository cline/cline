"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LoadingScreen } from "@/components/views/loading-screen";
import { SessionsView } from "@/components/views/sessions/sessions-view";
import {
	type SettingsSection,
	SettingsView,
} from "@/components/views/settings/settings-view";
import { AccountProvider } from "@/contexts/account-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import { useAppUpdate } from "@/hooks/use-app-update";
import { useChatSession } from "@/hooks/use-chat-session";
import { useSessionHistory } from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";
import { syncDesktopWindowTitle } from "@/lib/desktop-window-title";
import {
	getSessionMetadataTitle,
	type SessionHistoryItem,
	type SessionMetadata,
} from "@/lib/session-history";
import { syncHubTheme, watchSystemHubTheme } from "@/lib/theme";
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

type Thread = {
	id: string;
	historySession?: SessionHistoryItem;
	hasStarted?: boolean;
};

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
	const [view, setView] = useState<"chat" | "sessions" | "settings">("chat");
	const [isLoading, setIsLoading] = useState(true);
	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("General");
	const [threads, setThreads] = useState<Thread[]>(() => [
		{ id: makeThreadId() },
	]);
	const [activeThreadId, setActiveThreadId] = useState<string>(
		() => threads[0]?.id,
	);

	useAppUpdate();

	useEffect(() => {
		syncHubTheme();
		return watchSystemHubTheme();
	}, []);

	useEffect(() => {
		void syncDesktopWindowTitle();
	}, []);

	const handleNewThread = useCallback(() => {
		const id = makeThreadId();
		setThreads((prev) => [...prev, { id }]);
		setActiveThreadId(id);
		setView("chat");
	}, []);

	const handleOpenSession = useCallback((session: SessionHistoryItem) => {
		const threadId = `session_${session.sessionId}`;
		setThreads((prev) => {
			const existingIdx = prev.findIndex((item) => item.id === threadId);
			if (existingIdx >= 0) {
				const next = [...prev];
				next[existingIdx] = {
					...next[existingIdx],
					hasStarted: true,
					historySession: session,
				};
				return next;
			}
			return [
				...prev,
				{ id: threadId, hasStarted: true, historySession: session },
			];
		});
		setActiveThreadId(threadId);
		setView("chat");
	}, []);

	const handleDeleteSession = useCallback(
		(deletedSessionId: string, deletedThreadId?: string) => {
			const historyThreadId = `session_${deletedSessionId}`;
			const deletedWasActive =
				activeThreadId === deletedThreadId ||
				activeThreadId === historyThreadId;
			const fallback = deletedWasActive ? { id: makeThreadId() } : null;
			let emptyFallbackId: string | null = null;
			setThreads((prev) => {
				const next = prev.filter(
					(thread) =>
						thread.id !== deletedThreadId &&
						thread.id !== historyThreadId &&
						thread.historySession?.sessionId !== deletedSessionId,
				);
				if (fallback) {
					return [...next, fallback];
				}
				if (next.length === 0) {
					emptyFallbackId = makeThreadId();
					return [{ id: emptyFallbackId }];
				}
				return next;
			});
			if (fallback) {
				setActiveThreadId(fallback.id);
				return;
			}
			if (emptyFallbackId) {
				setActiveThreadId(emptyFallbackId);
			}
		},
		[activeThreadId],
	);

	const handleUpdateSessionMetadata = useCallback(
		(sessionId: string, metadata: SessionMetadata) => {
			setThreads((prev) =>
				prev.map((thread) => {
					if (thread.historySession?.sessionId !== sessionId) {
						return thread;
					}
					return {
						...thread,
						historySession: {
							...thread.historySession,
							metadata,
						},
					};
				}),
			);
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
		setView("chat");
	}, [activeThread, handleNewThread]);
	const handleThreadStarted = useCallback((threadId: string) => {
		setThreads((current) =>
			current.map((thread) =>
				thread.id === threadId && !thread.hasStarted
					? { ...thread, hasStarted: true }
					: thread,
			),
		);
	}, []);
	const sessionHistory = useSessionHistory({
		activeSessionId: activeHistorySessionId,
		onDeleteSession: handleDeleteSession,
		onOpenSession: handleOpenSession,
		onUpdateSessionMetadata: handleUpdateSessionMetadata,
	});
	const historyWorkspacePaths = useMemo(
		() => workspacePathsFromSessions(sessionHistory.sessions),
		[sessionHistory.sessions],
	);

	if (isLoading) {
		return <LoadingScreen onComplete={() => setIsLoading(false)} />;
	}

	return (
		<AccountProvider>
			<SidebarProvider>
				<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
					<Sidebar
						className="border-r border-sidebar-border"
						collapsible="icon"
					>
						<AgentSidebar
							activeSessionId={activeHistorySessionId}
							isHomeActive={
								view === "chat" &&
								!activeThread?.historySession &&
								!activeThread?.hasStarted
							}
							onHome={handleHome}
							onNewThread={handleNewThread}
							onSettingsSectionChange={setSettingsSection}
							sessionHistory={sessionHistory}
							setView={setView}
							settingsSection={settingsSection}
							view={view}
						/>
						<SidebarRail />
					</Sidebar>
					<SidebarInset className="min-h-0 min-w-0 overflow-hidden">
						<SidebarTrigger className="absolute left-3 top-3 z-40 md:hidden" />
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
									knownWorkspacePaths={historyWorkspacePaths}
									onUpdateSessionMetadata={handleUpdateSessionMetadata}
									threadId={activeThread.id}
									onDeleteSession={handleDeleteSession}
									onNewThread={handleNewThread}
									onOpenSession={handleOpenSession}
									onThreadStarted={handleThreadStarted}
								/>
							</div>
						) : null}
						{view === "settings" ? (
							<div className="absolute inset-0 z-30 bg-background text-foreground">
								<SettingsView
									onNavigateSection={setSettingsSection}
									section={settingsSection}
								/>
							</div>
						) : null}
					</SidebarInset>
				</div>
			</SidebarProvider>
		</AccountProvider>
	);
}

function ChatThreadPane({
	threadId,
	historySession,
	knownWorkspacePaths,
	onUpdateSessionMetadata,
	onDeleteSession,
	onNewThread,
	onOpenSession,
	onThreadStarted,
}: {
	threadId: string;
	historySession?: SessionHistoryItem;
	knownWorkspacePaths: string[];
	onUpdateSessionMetadata?: (
		sessionId: string,
		metadata: SessionMetadata,
	) => void;
	onDeleteSession?: (sessionId: string, threadId?: string) => void;
	onNewThread?: () => void;
	onOpenSession?: (session: SessionHistoryItem) => void;
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
	const [promptInput, setPromptInput] = useState("");
	const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
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
	const workspaceRef = useRef({
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
	});
	workspaceRef.current = {
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
	};

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
				const payload = await desktopClient.invoke<{
					providers?: Array<{
						id?: string;
						apiKey?: string;
						baseUrl?: string;
					}>;
				}>("list_provider_catalog");
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
		try {
			const payload = await desktopClient.invoke<{ branch?: string }>(
				"get_git_branch",
				{
					cwd: getWorkspaceCwd(),
				},
			);
			const branch = payload?.branch?.trim();
			setGitBranch(branch && branch.length > 0 ? branch : "no-git");
		} catch {
			setGitBranch("no-git");
		}
	}, [getWorkspaceCwd]);

	const listGitBranches = useCallback(async (): Promise<{
		current: string;
		branches: string[];
	}> => {
		try {
			const payload = await desktopClient.invoke<{
				current?: string;
				branches?: string[];
			}>("list_git_branches", {
				cwd: getWorkspaceCwd(),
			});
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
			try {
				const payload = await desktopClient.invoke<{ branch?: string }>(
					"checkout_git_branch",
					{
						cwd: getWorkspaceCwd(),
						branch: nextBranch,
					},
				);
				const branch = payload?.branch?.trim();
				setGitBranch(branch && branch.length > 0 ? branch : "no-git");
				return true;
			} catch {
				return false;
			}
		},
		[getWorkspaceCwd],
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

			setConfig((prev) => ({
				...prev,
				workspaceRoot: nextWorkspace,
				cwd: nextWorkspace,
			}));
			setWorkspaces((prev) =>
				filterWorkspacePaths(mergeWorkspacePaths(prev, [nextWorkspace])),
			);

			// Fire git branch + workspace list refresh in the background
			desktopClient
				.invoke<{ branch?: string }>("get_git_branch", {
					cwd: nextWorkspace,
				})
				.then((payload) => {
					const branch = payload?.branch?.trim();
					setGitBranch(branch && branch.length > 0 ? branch : "no-git");
				})
				.catch(() => {
					setGitBranch("no-git");
				});

			// Refresh the merged history, stored, and current workspace catalog.
			void refreshWorkspaces(nextWorkspace);

			return true;
		},
		[setConfig, refreshWorkspaces],
	);

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
	}, [refreshGitBranch]);

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
	}, [historySession, manualTitle, reset, threadId]);

	useEffect(() => {
		if (!historySession) {
			return;
		}
		if (hydratedSessionRef.current === historySession.sessionId) {
			return;
		}
		hydratedSessionRef.current = historySession.sessionId;
		setPromptInput("");
		setPendingAttachments([]);
		setManualTitle(getSessionMetadataTitle(historySession.metadata));
		void hydrateSession(historySession);
	}, [historySession, hydrateSession]);

	const handleSend = useCallback(async () => {
		const trimmed = promptInput.trim();
		if (!trimmed && pendingAttachments.length === 0) {
			return;
		}
		onThreadStarted?.(threadId);
		setPromptInput("");
		const toSend = [...pendingAttachments];
		setPendingAttachments([]);
		await sendPrompt(trimmed, toSend);
	}, [onThreadStarted, pendingAttachments, promptInput, sendPrompt, threadId]);

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

	const handleUndoQueuedPrompt = useCallback(
		async (item: PromptInQueue) => {
			const removed = await removePromptInQueue(item.id);
			const prompt = removed?.prompt.trim();
			if (!prompt) {
				return;
			}
			const attachmentCount =
				removed?.attachmentCount ?? item.attachmentCount ?? 0;
			if (attachmentCount > 0) {
				toast({
					title: "Queued attachments removed",
					description: "Reattach files before sending the restored message.",
				});
			}
			setPromptInput((current) =>
				current.trim().length > 0 ? `${current}\n\n${prompt}` : prompt,
			);
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

	const handleForkSession = useCallback(async () => {
		const result = await forkSession();
		// Open the forked session as a new thread in the sidebar.
		if (onOpenSession) {
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
			onOpenSession(forkedHistorySession);
		}
	}, [config, forkSession, onOpenSession]);

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
	]);

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
		}),
		[
			resolvedWorkspaceRoot,
			workspaces,
			listWorkspaces,
			refreshWorkspaces,
			switchWorkspace,
			pickWorkspaceDirectory,
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
			onAttachFiles={(files) => {
				setPendingAttachments((prev) => {
					const existing = new Set(
						prev.map(
							(file) => `${file.name}:${file.size}:${file.lastModified}`,
						),
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
			}}
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
			onPromptInputChange={setPromptInput}
			onReasoningChange={handleReasoningChange}
			onSteerPromptInQueue={(promptId) => {
				void steerPromptInQueue(promptId);
			}}
			onEditPromptInQueue={(promptId, prompt) => {
				void updatePromptInQueue(promptId, prompt);
			}}
			onUndoPromptInQueue={(item) => {
				void handleUndoQueuedPrompt(item);
			}}
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
			onSend={() => void handleSend()}
			gitBranch={gitBranch}
			model={config.model}
			mode={config.mode}
			promptsInQueue={promptsInQueue}
			promptInput={promptInput}
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
			<div
				className={
					isWelcomeState
						? "grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden"
						: "grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
				}
			>
				{!isWelcomeState ? (
					<div className="z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
						<AgentHeader
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
								onRestoreCheckpoint={(runCount) =>
									void restoreCheckpoint(runCount)
								}
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
