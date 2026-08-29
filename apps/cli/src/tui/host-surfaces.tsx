import type {
	HostSurfaceContext,
	HostSurfaces,
	InteractiveConfigData,
	LoadInteractiveConfigDataOptions,
	ResumedSessionEntries,
} from "@cline/ui/tui";
import { withLoadingDialog } from "@cline/ui/tui";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { HistoryExportFormat } from "../session/history-export";
import type { Config } from "../utils/types";
import type { ClineAccountSnapshot } from "./cline-account";
import { HistoryDialogContent } from "./history-view";
import { createAccountDialogOpener } from "./hooks/use-account-dialog";
import { createMcpManagerOpener } from "./hooks/use-mcp-manager";
import { createModelSelectorOpener } from "./hooks/use-model-selector";
import { OnboardingView } from "./onboarding";

export interface CliHostSurfaceDeps {
	config: Config;
	loadConfigData: (
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData>;
	onSessionRestart: () => Promise<void>;
	onModelChange: () => Promise<void>;
	loadAccount: () => Promise<ClineAccountSnapshot>;
	switchAccount: (organizationId?: string | null) => Promise<void>;
	onAccountChange: () => Promise<void>;
	onResumeSession: (sessionId: string) => Promise<ResumedSessionEntries>;
	onExportHistorySession: (
		sessionId: string,
		format: HistoryExportFormat,
	) => Promise<string>;
	onDeleteHistorySession: (sessionId: string) => Promise<boolean>;
}

/**
 * CLI implementations of the runtime-owned UX surfaces the shared terminal
 * UI delegates to: provider/model selection, MCP management, account,
 * session history, and onboarding. Each surface talks to the CLI runtime
 * directly and drives the UI only through the provided context.
 */
export function createCliHostSurfaces(
	deps: CliHostSurfaceDeps,
): (ctx: HostSurfaceContext) => HostSurfaces {
	return (ctx) => {
		const openModelSelector = createModelSelectorOpener({
			dialog: ctx.dialog,
			config: deps.config,
			termHeight: ctx.termHeight,
			onModelChange: deps.onModelChange,
			refocusTextarea: ctx.refocusTextarea,
		});

		const openMcpManager = createMcpManagerOpener({
			dialog: ctx.dialog,
			termHeight: ctx.termHeight,
			loadConfigData: deps.loadConfigData,
			onSessionRestart: deps.onSessionRestart,
			refocusTextarea: ctx.refocusTextarea,
		});

		const openAccountDialog = createAccountDialogOpener({
			dialog: ctx.dialog,
			termHeight: ctx.termHeight,
			loadAccount: deps.loadAccount,
			switchAccount: deps.switchAccount,
			onAccountChange: deps.onAccountChange,
			openModelSelector,
			refocusTextarea: ctx.refocusTextarea,
		});

		const openHistory = async (): Promise<void> => {
			const sessionId = await ctx.dialog.choice<string>({
				size: "large",
				style: { maxHeight: ctx.termHeight - 2 },
				content: (choiceCtx: ChoiceContext<string>) => (
					<HistoryDialogContent
						{...choiceCtx}
						onExport={deps.onExportHistorySession}
						onDelete={deps.onDeleteHistorySession}
					/>
				),
			});
			if (sessionId) {
				try {
					await withLoadingDialog(
						ctx.dialog,
						"Loading session...",
						async () => {
							const result = await deps.onResumeSession(sessionId);
							const { entries } = result;
							if (entries.length === 0) {
								ctx.session.appendEntry({
									kind: "error",
									text: `Session ${sessionId} has no messages to resume.`,
								});
							} else {
								ctx.session.clearEntries();
								// replaceEntries rather than appendEntry: appendEntry
								// stamps unstamped entries with the CURRENT mode, which
								// would lock hydrated history to the resume-time accent.
								ctx.session.replaceEntries(entries);
								if (typeof result.currentContextSize === "number") {
									ctx.session.setLastTotalTokens(result.currentContextSize);
								}
								if (typeof result.totalCost === "number") {
									ctx.session.setLastTotalCost(result.totalCost);
								}
								ctx.session.setHasSubmitted(true);
								ctx.setAppView("chat");
							}
						},
					);
				} catch (error) {
					ctx.session.appendEntry({
						kind: "error",
						text: `Failed to resume session: ${error instanceof Error ? error.message : String(error)}`,
					});
				}
			}
			ctx.refocusTextarea();
		};

		return {
			openModelSelector,
			openMcpManager,
			openAccountDialog,
			openHistory,
			renderOnboarding: ({ onComplete, onExit }) => (
				<OnboardingView onComplete={onComplete} onExit={onExit} />
			),
		};
	};
}
