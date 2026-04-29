import type { Message } from "@clinebot/shared";
import { formatDisplayUserInput, truncateStr } from "@clinebot/shared";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import {
	DialogProvider,
	useDialog,
	useDialogState,
} from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepoStatus } from "../utils/repo-status";
import { readRepoStatus } from "../utils/repo-status";
import {
	CheckpointConfirmContent,
	type CheckpointRestoreMode,
} from "./components/dialogs/checkpoint-confirm";
import {
	CheckpointPickerContent,
	type CheckpointPickerItem,
	type CheckpointPickerResult,
} from "./components/dialogs/checkpoint-picker";
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
import { ChatView } from "./views/chat-view";
import { HomeView } from "./views/home-view";
import { type OnboardingResult, OnboardingView } from "./views/onboarding";

function App(props: TuiProps) {
	const session = useSession();
	const renderer = useRenderer();
	const dialog = useDialog();
	const isDialogOpen = useDialogState((s: { isOpen: boolean }) => s.isOpen);
	const { height: termHeight } = useTerminalDimensions();

	const [repoStatus, setRepoStatus] = useState<RepoStatus>(
		props.initialRepoStatus ?? { branch: null, diffStats: null },
	);
	const { queuedPrompts, handlePendingPrompts } = useQueuedPrompts();
	const [appView, setAppView] = useState<AppView>(() => {
		if (process.env.CLINE_FORCE_ONBOARDING === "1") return "onboarding";
		if (!isProviderConfigured(props.config)) return "onboarding";
		return props.initialView === "chat" || session.entries.length > 0
			? "chat"
			: "home";
	});
	const [activeProviderId, setActiveProviderId] = useState(
		props.config.providerId,
	);
	const [toast, setToast] = useState<ToastState | null>(null);
	const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const checkpointRestoreInFlightRef = useRef(false);

	const workspaceRoot = props.config.workspaceRoot?.trim() || props.config.cwd;
	const canForkSession = session.hasSubmitted || session.entries.length > 0;
	const showClineAccountCommand = activeProviderId === "cline";

	const {
		registry: slashCommandRegistry,
		systemCommands,
		skillCommands,
	} = useSlashCommands({
		workflowSlashCommands: props.workflowSlashCommands,
		loadAdditionalSlashCommands: props.loadAdditionalSlashCommands,
		canFork: canForkSession,
		showClineAccountCommand,
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
		setActiveProviderId(props.config.providerId);
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

	const openConfig = useConfigPanel({
		dialog,
		config: props.config,
		sessionUiMode: session.uiMode,
		toggleMode,
		toggleAutoApprove: () => session.toggleAutoApprove(),
		termHeight,
		loadConfigData: props.loadConfigData,
		onToggleConfigItem: props.onToggleConfigItem,
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
		session.clearEntries();
		session.setHasSubmitted(false);
		try {
			await props.onSessionRestart();
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
		props.onExit();
	}, [props]);

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
		return () => {
			clearToastTimeout();
		};
	}, [clearToastTimeout]);
	const {
		appendEntry: appendSessionEntry,
		replaceEntries: replaceSessionEntries,
		setHasSubmitted: setSessionHasSubmitted,
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
			.then((messages) => {
				if (cancelled || messages.length === 0) {
					return;
				}
				const currentSession = deferredHydrationGuardRef.current;
				if (currentSession.hasSubmitted || currentSession.entryCount > 0) {
					return;
				}
				replaceSessionEntries(hydrateSessionMessages(messages));
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
		refocusTextarea: () => refocusTextareaRef.current(),
		setAppView,
		onClearConversation: clearConversation,
		onResumeSession: props.onResumeSession,
		onCompact: props.onCompact,
		onFork: props.onFork,
		onUndo: openCheckpointRestore,
		onExit: exitCline,
	});

	const agentHandlers = useAgentEventHandlers({
		appendEntry: session.appendEntry,
		updateLastEntry: session.updateLastEntry,
		updateEntry: session.updateEntry,
		closeInlineStream: session.closeInlineStream,
		activeInlineStreamRef: session.activeInlineStreamRef,
		setIsRunning: session.setIsRunning,
		setIsStreaming: session.setIsStreaming,
		onTurnErrorReported: props.onTurnErrorReported,
		verbose: props.config.verbose ?? false,
	});

	const promptInput = usePromptInputController({
		autocomplete,
		slashCommandRegistry,
		handleSlashCommand,
		onSubmit: props.onSubmit,
		initialPrompt: props.initialPrompt,
		configVerbose: props.config.verbose ?? false,
		refreshRepoStatus,
		setAppView,
		turnErrorReportedRef: agentHandlers.turnErrorReportedRef,
	});
	refocusTextareaRef.current = promptInput.refocusTextarea;
	populateInputRef.current = (value: string) => {
		promptInput.setInputValue(value);
		promptInput.setInputKey((k) => k + 1);
	};
	const initialPromptSubmittedRef = useRef(false);

	useEffect(() => {
		if (isDialogOpen || appView === "onboarding") return;
		promptInput.focusTextarea();
	}, [isDialogOpen, appView, promptInput.focusTextarea]);

	useEffect(() => {
		if (initialPromptSubmittedRef.current) return;
		if (appView === "onboarding") return;
		if (!props.initialPrompt?.trim()) return;
		const timeout = setTimeout(() => {
			if (initialPromptSubmittedRef.current) return;
			initialPromptSubmittedRef.current = true;
			promptInput.submitInitialPrompt();
		}, 0);
		return () => clearTimeout(timeout);
	}, [appView, promptInput.submitInitialPrompt, props.initialPrompt]);

	useRootKeyboard({
		isDialogOpen,
		appView,
		autocomplete,
		inputHistory: promptInput.inputHistory,
		inputValueRef: promptInput.inputValueRef,
		selectRef: promptInput.selectRef,
		submitRef: promptInput.submitRef,
		syncInputFromTextarea: promptInput.syncInputFromTextarea,
		setInputKey: promptInput.setInputKey,
		setInputValue: promptInput.setInputValue,
		onAbort: props.onAbort,
		onExit: props.onExit,
		onToggleMode: toggleMode,
		onClearConversation: clearConversation,
		onRestoreCheckpoint: openCheckpointRestore,
	});

	useRuntimeDialogBridge({
		setToolApprover: props.setToolApprover,
		setAskQuestion: props.setAskQuestion,
		setModeChangeNotifier: props.setModeChangeNotifier,
		setUiMode: session.setUiMode,
		refocusTextarea: promptInput.refocusTextarea,
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
		onSubmit: promptInput.handleSubmit,
		onContentChange: promptInput.handleContentChange,
		onImagePaste: promptInput.handleImagePaste,
		onLargeTextPaste: promptInput.handleLargeTextPaste,
		repoStatus,
		textareaRef: promptInput.textareaRef,
		queuedPrompts,
		onToggleMode: toggleMode,
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
					props.onExit();
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
					onRunningChange={props.onRunningChange}
					onAutoApproveChange={props.onAutoApproveChange}
					onExit={props.onExit}
				>
					<App {...props} />
				</SessionProvider>
			</DialogProvider>
		</TerminalColorsContext>
	);
}
