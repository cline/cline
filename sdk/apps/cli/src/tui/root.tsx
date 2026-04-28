import type { Selection } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import {
	DialogProvider,
	useDialog,
	useDialogState,
} from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepoStatus } from "../utils/repo-status";
import { readRepoStatus } from "../utils/repo-status";
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
import type { AppView, TuiProps } from "./types";
import { hydrateSessionMessages } from "./utils/hydrate-messages";
import { isProviderConfigured } from "./utils/provider-configured";
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

	const exitCline = useCallback(() => {
		props.onExit();
	}, [props]);

	useEffect(() => {
		const handleSelection = (selection: Selection) => {
			const text = selection.getSelectedText();
			if (!text) {
				return;
			}

			if (renderer.copyToClipboardOSC52(text)) {
				showToast("Copied to clipboard", "success");
			} else {
				showToast("Unable to copy selection", "error");
			}
		};

		renderer.on("selection", handleSelection);
		return () => {
			renderer.off("selection", handleSelection);
		};
	}, [renderer, showToast]);

	useEffect(() => {
		return () => {
			clearToastTimeout();
		};
	}, [clearToastTimeout]);

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
	const initialPromptSubmittedRef = useRef(false);

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

export function Root(props: TuiProps) {
	const initialEntries = useMemo(
		() => hydrateSessionMessages(props.initialMessages ?? []),
		[props.initialMessages],
	);
	return (
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
	);
}
