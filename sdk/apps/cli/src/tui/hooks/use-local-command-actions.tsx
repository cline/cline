import { summarizeUsageFromMessages } from "@clinebot/core";
import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialog } from "@opentui-ui/dialog/react";
import { useCallback } from "react";
import type { SlashCommandRegistry } from "../commands/slash-command-registry";
import { resolveSlashCommand } from "../commands/slash-command-registry";
import { ForkConfirmContent } from "../components/dialogs/fork-confirm";
import { HelpDialogContent } from "../components/dialogs/help-dialog";
import { useSession } from "../contexts/session-context";
import type { AppView, TuiProps } from "../types";
import { hydrateSessionMessages } from "../utils/hydrate-messages";
import { HistoryDialogContent } from "../views/history-view";
import { runLocalSlashCommandAction } from "./local-command-actions";

export function useLocalCommandActions(input: {
	slashCommandRegistry: SlashCommandRegistry;
	canForkSession: boolean;
	openAccount: () => void;
	openConfig: () => void;
	openMcpManager: () => Promise<boolean>;
	openModelSelector: () => void;
	refocusTextarea: () => void;
	setAppView: (view: AppView) => void;
	onClearConversation: () => Promise<void>;
	onResumeSession: TuiProps["onResumeSession"];
	onCompact: TuiProps["onCompact"];
	onFork: TuiProps["onFork"];
	onUndo: () => Promise<void>;
	onExit: TuiProps["onExit"];
}) {
	const dialog = useDialog();
	const session = useSession();
	const { height: termHeight } = useTerminalDimensions();
	const {
		slashCommandRegistry,
		canForkSession,
		openAccount,
		openConfig,
		openMcpManager,
		openModelSelector,
		refocusTextarea,
		setAppView,
		onClearConversation,
		onResumeSession,
		onCompact,
		onFork,
		onUndo,
		onExit,
	} = input;

	const openHistory = useCallback(async () => {
		const sessionId = await dialog.choice<string>({
			size: "large",
			style: { maxHeight: termHeight - 2 },
			content: (ctx: ChoiceContext<string>) => (
				<HistoryDialogContent {...ctx} />
			),
		});
		if (sessionId) {
			try {
				const messages = await onResumeSession(sessionId);
				const entries = hydrateSessionMessages(messages);
				if (entries.length === 0) {
					session.appendEntry({
						kind: "error",
						text: `Session ${sessionId} has no messages to resume.`,
					});
				} else {
					session.clearEntries();
					for (const entry of entries) {
						session.appendEntry(entry);
					}
					const usage = summarizeUsageFromMessages(messages);
					session.setLastTotalTokens(usage.inputTokens + usage.outputTokens);
					session.setLastTotalCost(usage.totalCost);
					session.setHasSubmitted(true);
					setAppView("chat");
				}
			} catch (error) {
				session.appendEntry({
					kind: "error",
					text: `Failed to resume session: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}
		refocusTextarea();
	}, [
		dialog,
		onResumeSession,
		refocusTextarea,
		session,
		setAppView,
		termHeight,
	]);

	const openHelp = useCallback(async () => {
		await dialog.choice<void>({
			size: "large",
			style: { maxHeight: termHeight - 2 },
			content: (ctx: ChoiceContext<void>) => <HelpDialogContent {...ctx} />,
		});
		refocusTextarea();
	}, [dialog, refocusTextarea, termHeight]);

	const runCompact = useCallback(async () => {
		session.appendEntry({
			kind: "status",
			text: "Compacting context...",
		});
		try {
			const result = await onCompact();
			session.updateLastEntry(() => ({
				kind: "status",
				text: `Compacted ${result.messagesBefore} messages to ${result.messagesAfter}`,
			}));
		} catch (error) {
			session.appendEntry({
				kind: "error",
				text: `Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}, [onCompact, session]);

	const runFork = useCallback(async () => {
		if (!canForkSession) {
			session.appendEntry({
				kind: "status",
				text: "Fork is available after this session has messages.",
			});
			return;
		}
		const confirmed = await dialog.choice<boolean>({
			closeOnEscape: true,
			content: (ctx: ChoiceContext<boolean>) => <ForkConfirmContent {...ctx} />,
		});
		refocusTextarea();
		if (!confirmed) return;
		session.appendEntry({
			kind: "status",
			text: "Creating forked session...",
		});
		try {
			const result = await onFork();
			if (result) {
				session.updateLastEntry(() => ({
					kind: "status",
					text: `Forked into new session ${result.newSessionId}. This is now the active session. Use /history to switch sessions.`,
				}));
			} else {
				session.updateLastEntry(() => ({
					kind: "error",
					text: "Fork failed: could not read messages from the current session.",
				}));
			}
		} catch (error) {
			session.updateLastEntry(() => ({
				kind: "error",
				text: `Fork failed: ${error instanceof Error ? error.message : String(error)}`,
			}));
		}
	}, [canForkSession, dialog, onFork, refocusTextarea, session]);

	const handleSlashCommand = useCallback(
		(command: string) => {
			const resolved = resolveSlashCommand(slashCommandRegistry, command);
			if (!resolved || resolved.execution !== "local") {
				return false;
			}
			return runLocalSlashCommandAction({
				name: resolved.name,
				openAccount,
				openConfig,
				openMcpManager,
				openModelSelector,
				runCompact,
				runFork,
				runUndo: onUndo,
				clearConversation: onClearConversation,
				openHelp,
				openHistory,
				exitCline: onExit,
			});
		},
		[
			onClearConversation,
			onExit,
			onUndo,
			openAccount,
			openConfig,
			openMcpManager,
			openHelp,
			openHistory,
			openModelSelector,
			runCompact,
			runFork,
			slashCommandRegistry,
		],
	);

	return { handleSlashCommand };
}
