"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { AgentSidebar } from "@/components/agent-sidebar";
import {
	Sidebar,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
} from "@/components/ui/sidebar";
import { ChatInputBar } from "@/components/views/chat/chat-input-bar";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import { DiffView } from "@/components/views/chat/diff-view";
import { SettingsView } from "@/components/views/settings/settings-view";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { useChatSession } from "@/hooks/use-chat-session";
import { desktopClient } from "@/lib/desktop-client";
import {
	getSessionMetadataTitle,
	type SessionHistoryItem,
	type SessionMetadata,
} from "@/lib/session-history";

function makeThreadId(): string {
	return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

type Thread = {
	id: string;
	historySession?: SessionHistoryItem;
};

type WorkspaceSessionItem = {
	cwd?: string;
	workspaceRoot?: string;
};

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
	const [view, setView] = useState<"chat" | "diff" | "settings">("chat");
	const [threads, setThreads] = useState<Thread[]>(() => [
		{ id: makeThreadId() },
	]);
	const [activeThreadId, setActiveThreadId] = useState<string>(
		() => threads[0]?.id,
	);
	const handleNewThread = useCallback(() => {
		const id = makeThreadId();
		setThreads((prev) => [...prev, { id }]);
		setActiveThreadId(id);
	}, []);

	const handleOpenSession = useCallback((session: SessionHistoryItem) => {
		const threadId = `session_${session.sessionId}`;
		setThreads((prev) => {
			const existingIdx = prev.findIndex((item) => item.id === threadId);
			if (existingIdx >= 0) {
				const next = [...prev];
				next[existingIdx] = {
					...next[existingIdx],
					historySession: session,
				};
				return next;
			}
			return [...prev, { id: threadId, historySession: session }];
		});
		setActiveThreadId(threadId);
	}, []);

	const handleDeleteSession = useCallback(
		(deletedSessionId: string) => {
			const historyThreadId = `session_${deletedSessionId}`;
			setThreads((prev) => {
				const next = prev.filter(
					(thread) =>
						thread.id !== historyThreadId &&
						thread.historySession?.sessionId !== deletedSessionId,
				);
				if (next.length === 0) {
					const fallback = { id: makeThreadId() };
					setActiveThreadId(fallback.id);
					return [fallback];
				}
				if (!next.some((thread) => thread.id === activeThreadId)) {
					setActiveThreadId(next[0]?.id);
				}
				return next;
			});
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

	const activeHistorySessionId =
		threads.find((thread) => thread.id === activeThreadId)?.historySession
			?.sessionId ?? null;
	const activeThread =
		threads.find((thread) => thread.id === activeThreadId) ?? threads[0];

	return (
		<>
			<SidebarProvider>
				<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
					<Sidebar
						className="border-r border-sidebar-border"
						collapsible="icon"
					>
						<AgentSidebar
							activeSessionId={activeHistorySessionId}
							onNewThread={handleNewThread}
							onOpenSession={handleOpenSession}
							setView={setView}
						/>
						<SidebarRail />
					</Sidebar>
					<SidebarInset className="min-h-0 min-w-0 overflow-hidden">
						{activeThread ? (
							<div className="flex min-h-0 flex-1 flex-col">
								<ChatThreadPane
									historySession={activeThread.historySession}
									onUpdateSessionMetadata={handleUpdateSessionMetadata}
									threadId={activeThread.id}
									onDeleteSession={handleDeleteSession}
									onNewThread={handleNewThread}
								/>
							</div>
						) : null}
					</SidebarInset>
				</div>
			</SidebarProvider>
			{view === "settings" ? (
				<div className="fixed inset-0 z-50 bg-background text-foreground">
					<SettingsView onClose={() => setView("chat")} />
				</div>
			) : null}
		</>
	);
}

function ChatThreadPane({
	threadId,
	historySession,
	onUpdateSessionMetadata,
	onDeleteSession,
	onNewThread,
}: {
	threadId: string;
	historySession?: SessionHistoryItem;
	onUpdateSessionMetadata?: (
		sessionId: string,
		metadata: SessionMetadata,
	) => void;
	onDeleteSession?: (sessionId: string) => void;
	onNewThread?: () => void;
}) {
	const {
		sessionId,
		status,
		chatTransportState,
		isHydratingSession,
		activeAssistantMessageId,
		config,
		messages,
		error,
		summary,
		fileDiffs,
		promptsInQueue,
		pendingToolApprovals,
		setConfig,
		sendPrompt,
		steerPromptInQueue,
		approveToolApproval,
		rejectToolApproval,
		reset,
		abort,
		hydrateSession,
	} = useChatSession();
	const [promptInput, setPromptInput] = useState("");
	const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
	const [showDiffView, setShowDiffView] = useState(false);
	const [deletingSession, setDeletingSession] = useState(false);
	const [renamingSession, setRenamingSession] = useState(false);
	const [manualTitle, setManualTitle] = useState("");
	const [gitBranch, setGitBranch] = useState("no-git");
	const [providerCredentials, setProviderCredentials] = useState<
		Record<string, { apiKey: string }>
	>({});
	const [providersLoaded, setProvidersLoaded] = useState(false);
	const [workspaces, setWorkspaces] = useState<string[]>([]);
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
			const roots = new Set<string>();
			const preferred = (preferredWorkspace || "").trim();
			if (preferred) {
				roots.add(preferred);
			}
			const current = (
				workspaceRef.current.workspaceRoot ||
				workspaceRef.current.cwd ||
				""
			).trim();
			if (current) {
				roots.add(current);
			}

			try {
				const discovered = await desktopClient
					.invoke<WorkspaceSessionItem[]>("list_discovered_sessions", {
						limit: 20,
					})
					.catch(() => []);

				for (const session of discovered) {
					const candidate = (session.workspaceRoot || session.cwd || "").trim();
					if (candidate) {
						roots.add(candidate);
					}
				}
			} catch {
				// Keep fallback to current workspace when history is unavailable.
			}

			return [...roots].sort((a, b) => a.localeCompare(b));
		},
		[],
	);

	const refreshWorkspaces = useCallback(
		async (preferredWorkspace?: string) => {
			try {
				const results = await listWorkspaces(preferredWorkspace);
				setWorkspaces(results);
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

			setConfig((prev) => ({
				...prev,
				workspaceRoot: nextWorkspace,
				cwd: nextWorkspace,
			}));
			setWorkspaces((prev) => {
				const next = new Set(prev);
				next.add(nextWorkspace);
				return [...next].sort((a, b) => a.localeCompare(b));
			});

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

			// Re-fetch workspace list so the new root appears
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
		setPromptInput("");
		const toSend = [...pendingAttachments];
		setPendingAttachments([]);
		await sendPrompt(trimmed, toSend);
	}, [pendingAttachments, promptInput, sendPrompt]);
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

	const activeSessionToDelete = sessionId ?? historySession?.sessionId ?? null;

	const handleDeleteSession = useCallback(async () => {
		if (!activeSessionToDelete || deletingSession) {
			return;
		}
		if (!window.confirm("Delete this session permanently?")) {
			return;
		}

		setDeletingSession(true);
		try {
			await desktopClient.invoke("delete_chat_session", {
				sessionId: activeSessionToDelete,
			});
			setPromptInput("");
			setPendingAttachments([]);
			setShowDiffView(false);
			await reset();
			onDeleteSession?.(activeSessionToDelete);
		} catch {
			// Keep current state when deletion fails.
		} finally {
			setDeletingSession(false);
		}
	}, [activeSessionToDelete, deletingSession, onDeleteSession, reset]);

	const attachmentList = pendingAttachments.map((file, index) => ({
		id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
		name: file.name,
		isImage: file.type.startsWith("image/"),
	}));

	const firstUserMessage = messages.find(
		(message) => message.role === "user",
	)?.content;
	const metadataTitle =
		manualTitle || getSessionMetadataTitle(historySession?.metadata);
	const threadTitle = toThreadTitle({
		title: metadataTitle,
		prompt: historySession?.prompt ?? firstUserMessage,
	});
	const hasDiffChanges = summary.additions + summary.deletions > 0;

	const activeSessionForTitle = sessionId ?? historySession?.sessionId ?? null;

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
			refreshWorkspaces: async () => {
				await refreshWorkspaces();
			},
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
		chatTransportState === "connected" &&
		resolvedWorkspaceRoot.length > 0 &&
		providersLoaded &&
		workspacesLoaded;

	if (!isAppReady) {
		return (
			<div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-background text-foreground">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
				<p className="text-sm text-muted-foreground">
					{chatTransportState !== "connected"
						? "Connecting..."
						: "Loading workspace..."}
				</p>
			</div>
		);
	}

	return (
		<WorkspaceProvider value={workspaceContextValue}>
			<div className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
				<div className="z-20">
					<AgentHeader
						canEditTitle={Boolean(activeSessionForTitle)}
						canDeleteSession={Boolean(activeSessionToDelete)}
						deletingSession={deletingSession}
						diff={{
							additions: summary.additions,
							deletions: summary.deletions,
						}}
						onDeleteSession={() => void handleDeleteSession()}
						onNewThread={onNewThread}
						onOpenDiff={() => {
							if (hasDiffChanges) {
								setShowDiffView(true);
							}
						}}
						onRenameTitle={handleRenameTitle}
						renamingTitle={renamingSession}
						status={status}
						title={threadTitle}
					/>
				</div>
				<div className="h-full min-h-0 overflow-hidden">
					{showDiffView ? (
						<DiffView
							fileDiffs={fileDiffs}
							onClose={() => setShowDiffView(false)}
						/>
					) : (
						<ChatMessages
							onApproveToolApproval={handleApproveToolApproval}
							onRejectToolApproval={handleRejectToolApproval}
							onStartChat={(prompt) => {
								setPromptInput(prompt);
							}}
							chatTransportState={chatTransportState}
							error={error}
							messages={messages}
							model={config.model}
							pendingToolApprovals={pendingToolApprovals}
							provider={config.provider}
							sessionId={sessionId}
							streamingMessageId={activeAssistantMessageId}
							isSessionSwitching={isHydratingSession}
							status={status}
						/>
					)}
				</div>
				<div className="z-20 shrink-0">
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
						onRefreshGitBranch={() => void refreshGitBranch()}
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
						onSteerPromptInQueue={(promptId) => {
							void steerPromptInQueue(promptId);
						}}
						onProviderChange={(nextProvider) =>
							setConfig((prev) => {
								const selected = providerCredentials[nextProvider];
								const nextApiKey = selected?.apiKey ?? "";
								if (
									prev.provider === nextProvider &&
									prev.apiKey === nextApiKey
								) {
									return prev;
								}
								return {
									...prev,
									provider: nextProvider,
									apiKey: nextApiKey,
								};
							})
						}
						onReset={() => {
							setPendingAttachments([]);
							void reset();
						}}
						onSend={() => void handleSend()}
						gitBranch={gitBranch}
						model={config.model}
						mode={config.mode}
						promptsInQueue={promptsInQueue}
						promptInput={promptInput}
						provider={config.provider}
						status={status}
						summary={summary}
					/>
				</div>
			</div>
		</WorkspaceProvider>
	);
}
