import {
	type AgentEvent,
	type AgentResult,
	type ProviderSettings,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigService,
} from "@cline/core";
import type { ConsecutiveMistakeLimitContext } from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { logCliError } from "../logging/errors";
import { createCliCore } from "../session/session";
import { resolveClineWelcomeLine } from "../tui/interactive-welcome";
import {
	askQuestionInTerminal,
	requestToolApproval,
	submitAndExitInTerminal,
} from "../utils/approval";
import { formatCliErrorMessage } from "../utils/cline-pass-errors";
import { handleEvent, handleTeamEvent } from "../utils/events";
import {
	shouldZeroClineFreeModelCost,
	zeroCliAgentEventCost,
	zeroCliUsageCost,
} from "../utils/free-model-cost";
import { createRuntimeHooks } from "../utils/hooks";
import { setActiveCliSession, writeWarn } from "../utils/output";
import { formatPluginIssueWarnings } from "../utils/plugin-issues";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "./defaults";
import { resolveMistakeLimitDecision } from "./format";
import { buildUserInputMessage } from "./prompt";
import { createRunOutputter } from "./run-outputter";
import { subscribeToAgentEvents } from "./session-events";

export async function runAgent(
	prompt: string,
	config: Config,
	userInstructionService?: UserInstructionConfigService,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
	},
): Promise<void> {
	// A clean one-shot run should not inherit a stale nonzero process exit code
	// from lower layers or prior bookkeeping inside the same process.
	process.exitCode = 0;
	const output = createRunOutputter(config);

	if (config.verbose) {
		const clineWelcomeLine = await resolveClineWelcomeLine({
			config,
			clineApiBaseUrl: options?.clineApiBaseUrl,
			clineProviderSettings: options?.clineProviderSettings,
		});
		if (clineWelcomeLine) {
			output.welcome(clineWelcomeLine);
		}
	}

	const startTime = performance.now();
	void prewarmFileIndex(config.cwd).catch((error: unknown) => {
		logCliError(config.logger, "File index prewarm failed", { error });
	});

	const isYoloMode = config.mode === "yolo";
	const toolExecutors = {
		askQuestion: askQuestionInTerminal,
		submit: submitAndExitInTerminal,
	};
	const sessionManager = await createCliCore({
		capabilities: {
			toolExecutors,
			requestToolApproval,
		},
		forceLocalBackend: isYoloMode || config.sandbox === true,
		logger: config.logger,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
		toolPolicies: config.toolPolicies,
	});
	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: isYoloMode,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
		dispatchHookEvent: async (payload) => {
			await sessionManager.ingestHookEvent(payload);
		},
	});

	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;
	const displayedErrorMessages = new Set<string>();
	const shouldZeroCost = await shouldZeroClineFreeModelCost(config);

	const onAgentEvent = (rawEvent: AgentEvent): void => {
		const event = zeroCliAgentEventCost(rawEvent, shouldZeroCost);
		if (event.type === "content_start" && event.contentType === "reasoning") {
			reasoningChunkCount += 1;
			if (event.redacted) {
				redactedReasoningChunkCount += 1;
			}
		}
		if (
			event.type === "error" &&
			(!event.recoverable || config.verbose) &&
			event.error.message.trim()
		) {
			displayedErrorMessages.add(
				formatCliErrorMessage(event.error.message, {
					modelId: config.modelId,
				}).trim(),
			);
		}
		handleEvent(event, config);
	};
	const plannedSessionId = createSessionId();
	const unsubscribe = subscribeToAgentEvents(sessionManager, onAgentEvent, {
		sessionId: plannedSessionId,
	});

	// --- Abort & signal handling ---
	let abortRequested = false;
	let timedOut = false;
	let activeSessionId: string | undefined;

	const abortAll = () => {
		if (abortRequested) return false;
		abortRequested = true;
		if (activeSessionId) {
			sessionManager
				.abort(activeSessionId, new Error("Run-agent runtime abort requested"))
				.catch(() => {});
		}
		return true;
	};
	setActiveRuntimeAbort(abortAll);

	let cleanupDone: Promise<void> | undefined;
	const cleanupRuntime = () => {
		cleanupDone ??= (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			unsubscribe();
			await runtimeHooks.shutdown().catch(() => {});
			if (activeSessionId) {
				await sessionManager.stop(activeSessionId).catch(() => {});
			}
			await sessionManager.dispose("cli_run_shutdown").catch(() => {});
			setActiveRuntimeAbort(undefined);
		})();
		return cleanupDone;
	};

	const handleSigint = () => {
		if (abortAll()) {
			output.abortRequested("sigint");
			return;
		}
		void cleanupRuntime().finally(() => {
			process.exitCode = 0;
			process.exit(0);
		});
	};
	const handleSigterm = () => {
		if (abortAll()) {
			output.abortRequested("sigterm");
		}
	};
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	// --- Main execution ---
	try {
		output.runStarted(plannedSessionId);
		const {
			prompt: userInput,
			userImages,
			userFiles,
		} = await buildUserInputMessage(prompt, userInstructionService, {
			mode: config.mode,
		});
		const started = await sessionManager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				sessionId: plannedSessionId,
				execution: {
					...config.execution,
					loopDetection:
						config.execution?.loopDetection ?? CLI_DEFAULT_LOOP_DETECTION,
				},
				checkpoint: config.checkpoint ?? CLI_DEFAULT_CHECKPOINT_CONFIG,
				hooks: runtimeHooks.hooks,
				onTeamEvent: handleTeamEvent,
				onConsecutiveMistakeLimitReached: async (
					context: ConsecutiveMistakeLimitContext,
				) => resolveMistakeLimitDecision(config, context),
			},
			prompt: userInput,
			userImages: userImages.length > 0 ? userImages : undefined,
			userFiles: userFiles.length > 0 ? userFiles : undefined,
			interactive: false,
			localRuntime: {
				onTeamRestored: () =>
					output.teamRestored(config.teamName ?? "(unknown team)"),
			},
		});

		activeSessionId = started.sessionId;
		for (const warning of formatPluginIssueWarnings(started.pluginIssues)) {
			writeWarn(warning);
		}
		setActiveCliSession({
			manifest: started.manifest,
		});

		// Schedule timeout abort if configured.
		const timeoutMs =
			typeof config.timeoutSeconds === "number" &&
			Number.isFinite(config.timeoutSeconds) &&
			config.timeoutSeconds > 0
				? config.timeoutSeconds * 1000
				: undefined;
		const timeoutId = timeoutMs
			? setTimeout(() => {
					timedOut = true;
					abortAll();
				}, timeoutMs)
			: undefined;
		const clearRunTimeout = () => {
			if (timeoutId) clearTimeout(timeoutId);
		};

		// When start() already ran the first turn (non-interactive with prompt),
		// the session is finalized before start() returns. Use that result
		// directly; calling send() would fail with "session not found".
		let result: AgentResult | undefined;
		if (started.result) {
			clearRunTimeout();
			result = started.result;
		} else {
			result = await sessionManager
				.send({
					sessionId: started.sessionId,
					prompt: userInput,
					userImages: userImages.length > 0 ? userImages : undefined,
					userFiles: userFiles.length > 0 ? userFiles : undefined,
				})
				.finally(clearRunTimeout);
		}
		if (!result) {
			throw new Error("session manager did not return a result");
		}

		const usageSummary = await sessionManager.getAccumulatedUsage(
			started.sessionId,
		);
		const aggregateUsage = zeroCliUsageCost(
			usageSummary?.aggregateUsage,
			shouldZeroCost,
		);
		const usage = zeroCliUsageCost(
			aggregateUsage ?? usageSummary?.usage ?? result.usage,
			shouldZeroCost,
		);

		output.runResult(result, usage, aggregateUsage);

		if (abortRequested || result.finishReason === "aborted") {
			output.runAborted({
				abortRequested,
				timedOut,
				timeoutSeconds: config.timeoutSeconds,
			});
			if (timedOut) {
				process.exitCode = 1;
			}
			output.blankLine();
			return;
		}

		if (result.finishReason !== "completed") {
			const errorText = formatCliErrorMessage(result.text, {
				modelId: config.modelId,
			}).trim();
			if (errorText) {
				output.reportError(errorText, displayedErrorMessages.has(errorText));
			}
			process.exitCode = 1;
			return;
		}

		output.runFinished({
			result,
			usage,
			startTime,
			reasoningChunkCount,
			redactedReasoningChunkCount,
		});
		process.exitCode = 0;
	} catch (err) {
		const message = formatCliErrorMessage(err, { modelId: config.modelId });
		logCliError(config.logger, "CLI task run failed", { error: err });
		output.reportError(message);
		process.exitCode = 1;
	} finally {
		await cleanupRuntime();
	}
}
