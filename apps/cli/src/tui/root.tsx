import { getCurrentContextSize, summarizeUsageFromMessages } from "@cline/core";
import type { Message } from "@cline/shared";
import { formatDisplayUserInput, truncateStr } from "@cline/shared";
import type { KeyEvent } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import {
	DialogProvider,
	useDialog,
	useDialogState,
} from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MigrationNoticeContent } from "../kanban-migration/notice-dialog";
import type { RepoStatus } from "../utils/repo-status";
import { readRepoStatus } from "../utils/repo-status";
import type { TranscriptScrollHandle } from "./components/chat-message-list";
import {
	CheckpointConfirmContent,
	type CheckpointRestoreMode,
} from "./components/dialogs/checkpoint-confirm";
import {
	CheckpointPickerContent,
	type CheckpointPickerItem,
	type CheckpointPickerResult,
} from "./components/dialogs/checkpoint-picker";
import {
	CommandPaletteContent,
	type CommandPaletteResult,
} from "./components/dialogs/command-palette";
import {
	buildCommandPaletteItems,
	findCommandPaletteShortcut,
} from "./components/dialogs/command-palette-items";
import {
	SKILLS_MARKETPLACE_ACTION,
	SKILLS_MARKETPLACE_URL,
	SkillsPickerContent,
} from "./components/dialogs/skills-picker";
import { Toast, type ToastState, type ToastVariant } from "./components/toast";
import { EventBridgeProvider } from "./contexts/event-bridge-context";
import { SessionProvider, useSession } from "./contexts/session-context";
import { useAccountDialog } from "./hooks/use-account-dialog";
import { useAgentEventHandlers } from "./hooks/use-agent-events";
import { useAutocomplete } from "./hooks/use-autocomplete";
import { useConfigPanel } from "./hooks/use-config-panel";
import { useLocalCommandActions } from "./hooks/use-local-command-actions";
import { useMcpManager } from "./hooks/use-mcp-manager";
import { useModelSelector } from "./hooks/use-model-selector";
import { usePromptInputController } from "./hooks/use-prompt-input-controller";
import { useQueuedPrompts } from "./hooks/use-queued-prompts";
import { useRootKeyboard } from "./hooks/use-root-keyboard";
import { useRuntimeDialogBridge } from "./hooks/use-runtime-dialog-bridge";
import { useSlashCommands } from "./hooks/use-slash-commands";
import { TerminalColorsContext } from "./hooks/use-terminal-background";
import type { AppView, TuiProps } from "./types";
import { hydrateSessionMessages } from "./utils/hydrate-messages";
import { isProviderConfigured } from "./utils/provider-configured";
import { createSelectionCopyHandler } from "./utils/selection-copy";
import type { LocalSlashCommandInvocation } from "./utils/skill-command-input";
import { deriveTerminalTitle } from "./utils/terminal-title";
import { ChatView } from "./views/chat-view";
import { HomeView } from "./views/home-view";
import { type OnboardingResult, OnboardingView } from "./views/onboarding";

function App(props: TuiProps) {
	const session = useSession();
	const renderer = useRenderer();
	const dialog = useDialog();
	const isDialogOpen = useDialogState((s: { isOpen: boolean }) => s.isOpen);
	const { height: termHeight, width: termWidth } = useTerminalDimensions();

	const [repoStatus, setRepoStatus] = useState<RepoStatus>(
		props.initialRepoStatus ?? { branch: null, diffStats: null },
	);
	const { queuedPrompts, handlePendingPrompts } = useQueuedPrompts();
	const [selectedQueuedPromptId, setSelectedQueuedPromptId] = useState<
		string | null
	>(null);
	const [editingQueuedPromptId, setEditingQueuedPromptId] = useState<
		string | null
	>(null);
	const [appView, setAppView] = useState<AppView>(() => {
		if (process.env.CLINE_FORCE_ONBOARDING === "1") return "onboarding";
		if (!isProviderConfigured(props.config)) return "onboarding";
		return props.initialView === "chat" || session.entries.length > 0
			? "chat"
			: "home";
	});
	const [toast, setToast] = useState<ToastState | null>(null);
	const [workflowSlashCommands, setWorkflowSlashCommands] = useState(
		props.workflowSlashCommands,
	);
	const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const checkpointRestoreInFlightRef = useRef(false);

	const workspaceRoot = props.config.workspaceRoot?.trim() || props.config.cwd;
	const canForkSession = session.hasSubmitted || session.entries.length > 0;
	const terminalTitle = useMemo(
		() =>
			deriveTerminalTitle({
				appView,
				entries: session.entries,
				initialPrompt: props.initialPrompt,
			}),
		[appView, props.initialPrompt, session.entries],
	);

	useEffect(() => {
		setWorkflowSlashCommands(props.workflowSlashCommands);
	}, [props.workflowSlashCommands]);

	const {
		registry: slashCommandRegistry,
		systemCommands,
		skillCommands,
		invokableSkillCommands,
	} = useSlashCommands({
		workflowSlashCommands,
		loadAdditionalSlashCommands: props.loadAdditionalSlashCommands,
		canFork: canForkSession,
	});

	const autocomplete = useAutocomplete({
		workspaceRoot,
		systemCommands,
		skillCommands,
	});

	const refreshRepoStatus = useCallback(() => {
		readRepoStatus(props.config.cwd)
			.then(setRepoStatus)
			.catch(() => {});
	}, [props.config.cwd]);

	const refocusTextareaRef = useRef<() => void>(() => {});
	const populateInputRef = useRef<(value: string) => void>(() => {});
	const insertSkillCommandRef = useRef<
		(command: string, invocation?: LocalSlashCommandInvocation) => void
	>(() => {});
	const removeLocalCommandInvocationRef = useRef<
		(invocation: LocalSlashCommandInvocation) => void
	>(() => {});
	const transcriptScrollRef = useRef<TranscriptScrollHandle | null>(null);
	const initialNoticeShownRef = useRef(false);
	const editingQueuedPrompt = useMemo(
		() =>
			editingQueuedPromptId
				? queuedPrompts.find((item) => item.id === editingQueuedPromptId)
				: undefined,
		[editingQueuedPromptId, queuedPrompts],
	);

	const clearToastTimeout = useCallback(() => {
		if (toastTimeoutRef.current) {
			clearTimeout(toastTimeoutRef.current);
			toastTimeoutRef.current = null;
		}
	}, []);

	const showToast = useCallback(
		(message: string, variant: ToastVariant = "info") => {
			clearToastTimeout();
			setToast({ message, variant });
			toastTimeoutRef.current = setTimeout(() => {
				setToast(null);
				toastTimeoutRef.current = null;
			}, 1800);
		},
		[clearToastTimeout],
	);

	const toggleMode = useCallback(() => {
		const newMode = session.uiMode === "act" ? "plan" : "act";
		session.toggleMode();
		void props.onModeChange(newMode);
	}, [props, session]);

	const handleModelChange = useCallback(async () => {
		await props.onModelChange();
	}, [props]);

	const openModelSelector = useModelSelector({
		dialog,
		config: props.config,
		termHeight,
		onModelChange: handleModelChange,
		refocusTextarea: () => refocusTextareaRef.current(),
	});

	const openMcpManager = useMcpManager({
		dialog,
		termHeight,
		loadConfigData: props.loadConfigData,
		onSessionRestart: props.onSessionRestart,
		refocusTextarea: () => refocusTextareaRef.current(),
	});
	const propsOnToggleConfigItem = props.onToggleConfigItem;
	const onToggleConfigItem = useMemo<TuiProps["onToggleConfigItem"]>(() => {
		if (!propsOnToggleConfigItem) {
			return undefined;
		}
		return async (item, options) => {
			const data = await propsOnToggleConfigItem(item, options);
			if (data) {
				setWorkflowSlashCommands(data.workflowSlashCommands);
			}
			return data;
		};
	}, [propsOnToggleConfigItem]);
	const propsOnDeleteConfigItem = props.onDeleteConfigItem;
	const onDeleteConfigItem = useMemo<TuiProps["onDeleteConfigItem"]>(() => {
		if (!propsOnDeleteConfigItem) {
			return undefined;
		}
		return async (item, options) => {
			const data = await propsOnDeleteConfigItem(item, options);
			if (data) {
				setWorkflowSlashCommands(data.workflowSlashCommands);
			}
			return data;
		};
	}, [propsOnDeleteConfigItem]);

	const openConfig = useConfigPanel({
		dialog,
		config: props.config,
		sessionUiMode: session.uiMode,
		compactionMode: session.compactionMode,
		toggleMode,
		toggleAutoApprove: () => session.toggleAutoApprove(),
		setCompactionMode: session.setCompactionMode,
		termHeight,
		loadConfigData: props.loadConfigData,
		onToggleConfigItem,
		onDeleteConfigItem,
		openModelSelector,
		openMcpManager,
		refocusTextarea: () => refocusTextareaRef.current(),
	});

	const openAccount = useAccountDialog({
		dialog,
		termHeight,
		loadAccount: props.loadClineAccount,
		switchAccount: props.switchClineAccount,
		onAccountChange: props.onAccountChange,
		openModelSelector,
		refocusTextarea: () => refocusTextareaRef.current(),
	});

	const clearConversation = useCallback(async () => {
		const shouldRestartSession = session.hasSubmitted;
		session.clearEntries();
		session.setHasSubmitted(false);
		if (!shouldRestartSession) {
			setAppView("home");
			refocusTextareaRef.current();
			return;
		}
		try {
			await props.onNewSession();
			setAppView("home");
		} catch (error) {
			setAppView("chat");
			session.appendEntry({
				kind: "error",
				text: `Clear failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		} finally {
			refocusTextareaRef.current();
		}
	}, [props, session]);

	const openCheckpointRestore = useCallback(async () => {
		if (checkpointRestoreInFlightRef.current) {
			showToast("Checkpoint restore already in progress", "info");
			return;
		}
		if (session.isRunning) {
			showToast("Wait for the current run to finish before restoring", "info");
			return;
		}
		checkpointRestoreInFlightRef.current = true;
		let restoreStatusEntryAppended = false;
		try {
			const data = await props.getCheckpointData();
			if (!data) {
				showToast("No checkpoint data available", "error");
				return;
			}
			const { messages: rawMessages, checkpointHistory } = data;
			if (checkpointHistory.length === 0) {
				showToast("No checkpoints available", "info");
				return;
			}
			const checkpointForRun = (runCount: number) =>
				checkpointHistory.reduce<
					(typeof checkpointHistory)[number] | undefined
				>((best, checkpoint) => {
					if (checkpoint.runCount > runCount) {
						return best;
					}
					if (!best || checkpoint.runCount > best.runCount) {
						return checkpoint;
					}
					return best;
				}, undefined);
			const items: CheckpointPickerItem[] = [];
			let userRunCount = 0;
			for (const msg of rawMessages as Array<
				Message & { metadata?: Record<string, unknown> }
			>) {
				if (msg.role !== "user") continue;
				const metadata =
					"metadata" in msg && msg.metadata && typeof msg.metadata === "object"
						? msg.metadata
						: undefined;
				if (metadata?.kind === "recovery_notice") continue;
				userRunCount += 1;
				const checkpoint = checkpointForRun(userRunCount);
				if (!checkpoint) continue;
				const text =
					typeof msg.content === "string"
						? msg.content
						: Array.isArray(msg.content)
							? msg.content
									.filter(
										(b): b is { type: "text"; text: string } =>
											typeof b === "object" &&
											b !== null &&
											"type" in b &&
											b.type === "text" &&
											"text" in b &&
											typeof b.text === "string",
									)
									.map((b) => b.text)
									.join(" ")
							: "";
				const preview = truncateStr(
					formatDisplayUserInput(text).replace(/\s+/g, " "),
					60,
				);
				if (!preview) continue;
				items.push({
					runCount: userRunCount,
					text: preview,
					fullText: text,
					createdAt: checkpoint.createdAt,
				});
			}
			if (items.length === 0) {
				showToast("No checkpoints to restore", "info");
				return;
			}

			const picked = await dialog.choice<CheckpointPickerResult>({
				size: "large",
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<CheckpointPickerResult>) => (
					<CheckpointPickerContent {...ctx} items={items} />
				),
			});
			if (!picked) {
				return;
			}
			const restoreMode = await dialog.choice<CheckpointRestoreMode>({
				closeOnEscape: true,
				content: (ctx: ChoiceContext<CheckpointRestoreMode>) => (
					<CheckpointConfirmContent
						{...ctx}
						messagePreview={picked.messagePreview}
					/>
				),
			});
			if (!restoreMode) {
				return;
			}
			const restoreWorkspace = restoreMode === "chat-and-workspace";
			session.appendEntry({
				kind: "status",
				text: `Restoring to checkpoint${restoreWorkspace ? " (chat + workspace)" : " (chat only)"}...`,
			});
			restoreStatusEntryAppended = true;
			const result = await props.onRestoreCheckpoint(
				picked.runCount,
				restoreWorkspace,
			);
			if (!result) {
				session.updateLastEntry(() => ({
					kind: "error",
					text: "Checkpoint restore failed: no result returned.",
				}));
				return;
			}
			session.clearEntries();
			const entries = hydrateSessionMessages(result.messages);
			// Remove the trailing user message -- it goes into the input
			// field so the user can edit and re-send it.
			const lastEntry = entries[entries.length - 1];
			if (lastEntry && lastEntry.kind === "user_submitted") {
				entries.pop();
			}
			for (const entry of entries) {
				session.appendEntry(entry);
			}
			session.setHasSubmitted(entries.length > 0);
			setAppView(entries.length > 0 ? "chat" : "home");
			populateInputRef.current(picked.fullText);
			showToast("Restored to checkpoint", "success");
		} catch (error) {
			const message = `Checkpoint restore failed: ${error instanceof Error ? error.message : String(error)}`;
			if (restoreStatusEntryAppended) {
				session.updateLastEntry(() => ({
					kind: "error",
					text: message,
				}));
			} else {
				showToast(message, "error");
			}
		} finally {
			checkpointRestoreInFlightRef.current = false;
			refocusTextareaRef.current();
		}
	}, [dialog, props, session, showToast, termHeight]);

	const exitCline = useCallback(() => {
		session.requestExit();
	}, [session]);

	const openSkills = useCallback(
		async (invocation?: LocalSlashCommandInvocation) => {
			const selected = await dialog.choice<string>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<string>) => (
					<SkillsPickerContent {...ctx} commands={invokableSkillCommands} />
				),
			});
			if (selected === SKILLS_MARKETPLACE_ACTION) {
				await import("open")
					.then(({ default: open }) => open(SKILLS_MARKETPLACE_URL))
					.catch(() => {
						showToast(`Visit ${SKILLS_MARKETPLACE_URL}`, "info");
					});
				if (invocation) {
					removeLocalCommandInvocationRef.current(invocation);
				} else {
					refocusTextareaRef.current();
				}
			} else if (selected) {
				insertSkillCommandRef.current(selected, invocation);
			} else if (invocation) {
				removeLocalCommandInvocationRef.current(invocation);
			} else {
				refocusTextareaRef.current();
			}
		},
		[dialog, invokableSkillCommands, showToast, termHeight],
	);

	useEffect(() => {
		const { handleSelection, dispose } = createSelectionCopyHandler({
			copyToClipboardOSC52: (text) => renderer.copyToClipboardOSC52(text),
			showToast,
		});

		renderer.on("selection", handleSelection);
		return () => {
			dispose();
			renderer.off("selection", handleSelection);
		};
	}, [renderer, showToast]);

	useEffect(() => {
		renderer.setTerminalTitle(terminalTitle);
	}, [renderer, terminalTitle]);

	useEffect(() => {
		return () => {
			renderer.setTerminalTitle("");
		};
	}, [renderer]);

	useEffect(() => {
		return () => {
			clearToastTimeout();
		};
	}, [clearToastTimeout]);

	useEffect(() => {
		const selectedPromptMissing =
			selectedQueuedPromptId &&
			!queuedPrompts.some((item) => item.id === selectedQueuedPromptId);
		const editingPromptMissing =
			editingQueuedPromptId &&
			!queuedPrompts.some((item) => item.id === editingQueuedPromptId);

		if (selectedPromptMissing) {
			setSelectedQueuedPromptId(null);
		}
		if (editingPromptMissing) {
			setEditingQueuedPromptId(null);
		}
		if (selectedPromptMissing || editingPromptMissing) {
			refocusTextareaRef.current();
		}
	}, [editingQueuedPromptId, queuedPrompts, selectedQueuedPromptId]);

	const selectQueuedPrompt = useCallback((promptId: string | null) => {
		setSelectedQueuedPromptId(promptId);
	}, []);

	const beginQueuedPromptEdit = useCallback(
		(promptId: string) => {
			const item = queuedPrompts.find((queued) => queued.id === promptId);
			if (!item) return;
			setSelectedQueuedPromptId(promptId);
			setEditingQueuedPromptId(promptId);
		},
		[queuedPrompts],
	);

	const cancelQueuedPromptEdit = useCallback(() => {
		setEditingQueuedPromptId(null);
		setSelectedQueuedPromptId(null);
		refocusTextareaRef.current();
	}, []);

	const promoteQueuedPrompt = useCallback(
		(promptId: string) => {
			void props
				.onUpdatePendingPrompt({ promptId, delivery: "steer" })
				.catch((error) => {
					showToast(
						`Could not steer queued message: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				});
		},
		[props, showToast],
	);

	const notice = props.initialNotice;
	const onInitialNoticeShown = props.onInitialNoticeShown;
	useEffect(() => {
		if (!notice) return;
		if (initialNoticeShownRef.current) return;
		if (appView !== "home") return;

		initialNoticeShownRef.current = true;
		const timeout = setTimeout(() => {
			void dialog
				.choice<boolean>({
					content: (ctx: ChoiceContext<boolean>) => (
						<MigrationNoticeContent {...ctx} notice={notice} />
					),
				})
				.finally(() => {
					Promise.resolve(onInitialNoticeShown?.(notice)).catch(() => {});
					refocusTextareaRef.current();
				});
		}, 0);
		return () => clearTimeout(timeout);
	}, [appView, dialog, notice, onInitialNoticeShown]);

	const {
		appendEntry: appendSessionEntry,
		replaceEntries: replaceSessionEntries,
		setHasSubmitted: setSessionHasSubmitted,
		setLastTotalCost: setSessionLastTotalCost,
		setLastTotalTokens: setSessionLastTotalTokens,
	} = session;
	const deferredHydrationGuardRef = useRef({
		hasSubmitted: session.hasSubmitted,
		entryCount: session.entries.length,
	});
	deferredHydrationGuardRef.current = {
		hasSubmitted: session.hasSubmitted,
		entryCount: session.entries.length,
	};

	useEffect(() => {
		const loadDeferredInitialMessages = props.loadDeferredInitialMessages;
		if (!loadDeferredInitialMessages) {
			return;
		}
		let cancelled = false;
		loadDeferredInitialMessages()
			.then((result) => {
				const { messages } = result;
				if (cancelled || messages.length === 0) {
					return;
				}
				const currentSession = deferredHydrationGuardRef.current;
				if (currentSession.hasSubmitted || currentSession.entryCount > 0) {
					return;
				}
				replaceSessionEntries(hydrateSessionMessages(messages));
				if (typeof result.currentContextSize === "number") {
					setSessionLastTotalTokens(result.currentContextSize);
				}
				if (typeof result.totalCost === "number") {
					setSessionLastTotalCost(result.totalCost);
				}
				setSessionHasSubmitted(true);
				setAppView("chat");
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				appendSessionEntry({
					kind: "error",
					text: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		props.loadDeferredInitialMessages,
		appendSessionEntry,
		replaceSessionEntries,
		setSessionHasSubmitted,
		setSessionLastTotalCost,
		setSessionLastTotalTokens,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
	useEffect(() => {
		if (props.initialView === "config") {
			openConfig();
		}
	}, []);

	const { handleSlashCommand } = useLocalCommandActions({
		slashCommandRegistry,
		canForkSession,
		openAccount,
		openConfig,
		openMcpManager,
		openModelSelector,
		openSkills,
		refocusTextarea: () => refocusTextareaRef.current(),
		setAppView,
		onClearConversation: clearConversation,
		onResumeSession: props.onResumeSession,
		onCompact: props.onCompact,
		onFork: props.onFork,
		onUndo: openCheckpointRestore,
		onExit: exitCline,
	});

	const runCommandPaletteResult = useCallback(
		async (result: CommandPaletteResult) => {
			if (result.action === "change-provider") {
				await openModelSelector({ startWithProviderChange: true });
				return;
			}
			if (result.action === "change-model") {
				await openModelSelector();
				return;
			}

			await Promise.resolve(handleSlashCommand(result.action));
		},
		[handleSlashCommand, openModelSelector],
	);

	const commandPaletteOpenRef = useRef(false);
	const globalPaletteItems = useMemo(
		() => buildCommandPaletteItems({ canForkSession }),
		[canForkSession],
	);
	const openCommandPalette = useCallback(async () => {
		if (commandPaletteOpenRef.current) return;
		commandPaletteOpenRef.current = true;
		const dialogWidth = Math.min(
			64,
			Math.max(48, Math.floor(termWidth * 0.58)),
			Math.max(42, termWidth - 8),
		);
		try {
			const result = await dialog.choice<CommandPaletteResult>({
				style: { width: dialogWidth, maxHeight: termHeight - 2 },
				content: (ctx: ChoiceContext<CommandPaletteResult>) => (
					<CommandPaletteContent
						{...ctx}
						canForkSession={canForkSession}
						contentWidth={dialogWidth - 2}
					/>
				),
			});
			if (result) {
				await runCommandPaletteResult(result);
				return;
			}
			refocusTextareaRef.current();
		} finally {
			commandPaletteOpenRef.current = false;
		}
	}, [canForkSession, dialog, runCommandPaletteResult, termHeight, termWidth]);

	const runCommandPaletteShortcut = useCallback(
		(key: KeyEvent) => {
			const shortcut = findCommandPaletteShortcut(globalPaletteItems, key);
			if (!shortcut) return false;
			key.preventDefault();
			void runCommandPaletteResult(shortcut.result);
			return true;
		},
		[globalPaletteItems, runCommandPaletteResult],
	);

	const agentHandlers = useAgentEventHandlers({
		appendEntry: session.appendEntry,
		updateLastEntry: session.updateLastEntry,
		updateEntry: session.updateEntry,
		closeInlineStream: session.closeInlineStream,
		activeInlineStreamRef: session.activeInlineStreamRef,
		setIsRunning: session.setIsRunning,
		setIsStreaming: session.setIsStreaming,
		addUsageDelta: session.addUsageDelta,
		onTurnErrorReported: props.onTurnErrorReported,
		verbose: props.config.verbose ?? false,
	});

	const promptInput = usePromptInputController({
		autocomplete,
		slashCommandRegistry,
		handleSlashCommand,
		onSubmit: props.onSubmit,
		initialPrompt: props.initialPrompt,
		providerId: props.config.providerId,
		configVerbose: props.config.verbose ?? false,
		refreshRepoStatus,
		setAppView,
		turnErrorReportedRef: agentHandlers.turnErrorReportedRef,
	});
	const focusPromptTextarea = promptInput.focusTextarea;
	const submitInitialPrompt = promptInput.submitInitialPrompt;
	refocusTextareaRef.current = promptInput.refocusTextarea;
	populateInputRef.current = (value: string) => {
		promptInput.populateInput(value);
	};
	insertSkillCommandRef.current = (command, invocation) => {
		promptInput.insertSkillCommand(command, invocation);
	};
	removeLocalCommandInvocationRef.current = (invocation) => {
		promptInput.removeLocalCommandInvocation(invocation);
	};
	const runtimeBridge = useRuntimeDialogBridge({
		setToolApprover: props.setToolApprover,
		setAskQuestion: props.setAskQuestion,
		setModeChangeNotifier: props.setModeChangeNotifier,
		setUiMode: session.setUiMode,
		refocusTextarea: promptInput.refocusTextarea,
	});
	const runtimeInteraction = runtimeBridge.interaction;
	const isRuntimeInteractionOpen = runtimeInteraction !== null;
	const saveQueuedPromptEdit = useCallback(
		async (promptId: string, text: string) => {
			if (!promptId) return;
			const prompt = text.trim();
			if (!prompt) {
				showToast("Queued message cannot be empty", "error");
				return;
			}
			try {
				await props.onUpdatePendingPrompt({ promptId, prompt });
				setEditingQueuedPromptId(null);
				setSelectedQueuedPromptId(null);
				refocusTextareaRef.current();
			} catch (error) {
				showToast(
					`Could not update queued message: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
		[props, showToast],
	);
	const submitFromInput = useCallback(() => {
		if (editingQueuedPromptId) {
			return;
		}
		if (selectedQueuedPromptId) {
			promoteQueuedPrompt(selectedQueuedPromptId);
			return;
		}
		promptInput.handleSubmit();
	}, [
		editingQueuedPromptId,
		promoteQueuedPrompt,
		promptInput,
		selectedQueuedPromptId,
	]);
	const focusPromptInput = useCallback(() => {
		if (editingQueuedPromptId || selectedQueuedPromptId) {
			setEditingQueuedPromptId(null);
			setSelectedQueuedPromptId(null);
			refocusTextareaRef.current();
			return;
		}
		promptInput.focusTextarea();
	}, [editingQueuedPromptId, promptInput, selectedQueuedPromptId]);
	const initialPromptSubmittedRef = useRef(false);

	useEffect(() => {
		if (isDialogOpen || isRuntimeInteractionOpen || appView === "onboarding") {
			return;
		}
		focusPromptTextarea();
	}, [isDialogOpen, isRuntimeInteractionOpen, appView, focusPromptTextarea]);

	useEffect(() => {
		if (initialPromptSubmittedRef.current) return;
		if (appView === "onboarding") return;
		if (!props.initialPrompt?.trim()) return;
		const timeout = setTimeout(() => {
			if (initialPromptSubmittedRef.current) return;
			initialPromptSubmittedRef.current = true;
			submitInitialPrompt();
		}, 0);
		return () => clearTimeout(timeout);
	}, [appView, submitInitialPrompt, props.initialPrompt]);

	useRootKeyboard({
		isDialogOpen: isDialogOpen || isRuntimeInteractionOpen,
		appView,
		autocomplete,
		inputHistory: promptInput.inputHistory,
		transcriptScrollRef,
		inputValueRef: promptInput.inputValueRef,
		selectRef: promptInput.selectRef,
		submitRef: promptInput.submitRef,
		queuedPromptSelection: {
			items: queuedPrompts,
			selectedId: selectedQueuedPromptId,
			editingId: editingQueuedPromptId,
			select: selectQueuedPrompt,
			beginEdit: beginQueuedPromptEdit,
			cancelEdit: cancelQueuedPromptEdit,
			promote: promoteQueuedPrompt,
		},
		syncInputFromTextarea: promptInput.syncInputFromTextarea,
		getCurrentInputText: promptInput.getCurrentInputText,
		setInputKey: promptInput.setInputKey,
		setInputValue: promptInput.setInputValue,
		onAbort: props.onAbort,
		onExit: exitCline,
		onToggleMode: toggleMode,
		onClearConversation: clearConversation,
		onRestoreCheckpoint: openCheckpointRestore,
		onOpenCommandPalette: openCommandPalette,
		onCommandPaletteShortcut: runCommandPaletteShortcut,
	});

	const acOptions = autocomplete.getFilteredOptions();

	const eventBridgeHandlers = useMemo(
		() => ({
			onAgentEvent: agentHandlers.handleAgentEvent,
			onTeamEvent: agentHandlers.handleTeamEvent,
			onPendingPrompts: handlePendingPrompts,
			onPendingPromptSubmitted: agentHandlers.handlePendingPromptSubmitted,
		}),
		[agentHandlers, handlePendingPrompts],
	);

	const viewProps = {
		config: props.config,
		inputValue: promptInput.inputValue,
		inputKey: promptInput.inputKey,
		onSubmit: submitFromInput,
		onContentChange: promptInput.handleContentChange,
		onImagePaste: promptInput.handleImagePaste,
		onLargeTextPaste: promptInput.handleLargeTextPaste,
		onInputFocusRequest: focusPromptInput,
		repoStatus,
		textareaRef: promptInput.textareaRef,
		transcriptScrollRef,
		queuedPrompts,
		selectedQueuedPromptId,
		editingQueuedPrompt,
		onQueuedPromptEditConfirm: (id: string, prompt: string) => {
			void saveQueuedPromptEdit(id, prompt);
		},
		onToggleMode: toggleMode,
		runtimeInteraction,
		onResolveToolApproval: runtimeBridge.resolveToolApproval,
		onResolveAskQuestion: runtimeBridge.resolveAskQuestion,
		autocomplete: {
			mode: autocomplete.mode,
			options: acOptions,
			selected: autocomplete.selected,
			onSelect: promptInput.selectAutocompleteOption,
		},
	};

	const wrapWithBridge = (children: React.ReactNode) => (
		<EventBridgeProvider
			subscribeToEvents={props.subscribeToEvents}
			handlers={eventBridgeHandlers}
		>
			{children}
		</EventBridgeProvider>
	);

	let content: React.ReactNode;

	if (appView === "onboarding") {
		content = (
			<OnboardingView
				onComplete={(result: OnboardingResult) => {
					props.config.providerId = result.providerId;
					props.config.modelId = result.modelId;
					props.config.apiKey = result.apiKey ?? "";
					if (result.thinking !== undefined) {
						props.config.thinking = result.thinking;
					}
					if (result.reasoningEffort !== undefined) {
						props.config.reasoningEffort = result.reasoningEffort;
					}

					handleModelChange().then(() => setAppView("home"));
				}}
				onExit={() => {
					exitCline();
				}}
			/>
		);
	} else if (session.hasSubmitted || appView === "chat") {
		content = <ChatView {...viewProps} />;
	} else {
		content = <HomeView {...viewProps} />;
	}

	return wrapWithBridge(
		<box flexDirection="column" width="100%" height="100%">
			{content}
			<Toast toast={toast} />
		</box>,
	);
}

export function Root(
	props: TuiProps & {
		terminalBackground?: string | null;
		terminalForeground?: string | null;
	},
) {
	const initialEntries = useMemo(
		() => hydrateSessionMessages(props.initialMessages ?? []),
		[props.initialMessages],
	);
	const initialUsage = useMemo(() => {
		const messages = props.initialMessages ?? [];
		const usage = summarizeUsageFromMessages(messages);
		return {
			totalTokens: getCurrentContextSize(messages) ?? 0,
			totalCost: usage.totalCost,
		};
	}, [props.initialMessages]);
	const terminalColors = useMemo(
		() => ({
			background: props.terminalBackground ?? null,
			foreground: props.terminalForeground ?? null,
		}),
		[props.terminalBackground, props.terminalForeground],
	);
	return (
		<TerminalColorsContext value={terminalColors}>
			<DialogProvider size="medium">
				<SessionProvider
					config={props.config}
					initialEntries={initialEntries}
					initialUsage={initialUsage}
					onRunningChange={props.onRunningChange}
					onAutoApproveChange={props.onAutoApproveChange}
					onCompactionModeChange={props.onCompactionModeChange}
					onExit={props.onExit}
				>
					<App {...props} />
				</SessionProvider>
			</DialogProvider>
		</TerminalColorsContext>
	);
}
