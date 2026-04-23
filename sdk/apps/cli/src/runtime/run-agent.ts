import {
	type AgentEvent,
	type AgentResult,
	type ProviderSettings,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import type { ConsecutiveMistakeLimitContext } from "@clinebot/shared";
import { createSessionId } from "@clinebot/shared";
import { createCliCore } from "../session/session";
import { resolveClineWelcomeLine } from "../tui/interactive-welcome";
import {
	askQuestionInTerminal,
	requestToolApproval,
	submitAndExitInTerminal,
} from "../utils/approval";
import { handleEvent, handleTeamEvent } from "../utils/events";
import { createRuntimeHooks } from "../utils/hooks";
import {
	c,
	emitJsonLine,
	formatUsd,
	getActiveCliSession,
	setActiveCliSession,
	writeErr,
	writeln,
} from "../utils/output";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "./defaults";
import { describeAbortSource, resolveMistakeLimitDecision } from "./format";
import { buildUserInputMessage } from "./prompt";
import { subscribeToAgentEvents } from "./session-events";

function printModelProviderInfo(config: Config): void {
	const catalog = config.knownModels ? "live" : "bundled";
	const thinking = config.thinking ? "on" : "off";
	const { mode, providerId, modelId } = config;
	if (config.outputMode === "json") {
		emitJsonLine("stdout", {
			type: "run_start",
			providerId,
			modelId,
			catalog,
			thinking,
			mode,
			sessionId: getActiveCliSession()?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${providerId} model=${modelId} catalog=${catalog} thinking=${thinking} mode=${mode}${c.reset}\n`,
	);
}

function emitAbortRequested(
	config: Config,
	reason: "sigint" | "sigterm",
): void {
	if (config.outputMode === "json") {
		emitJsonLine("stdout", { type: "run_abort_requested", reason });
	} else if (reason === "sigint") {
		writeln(`\n${c.dim}[abort] requested${c.reset}`);
	}
}

function emitTeamRestored(config: Config): void {
	const teamName = config.teamName ?? "(unknown team)";
	if (config.outputMode === "json") {
		emitJsonLine("stdout", { type: "team_restored", teamName });
		return;
	}
	writeln(
		`${c.dim}[team] restored persisted team state for "${teamName}"${c.reset}`,
	);
}

function printRunStats(
	config: Config,
	result: AgentResult,
	usage: AgentResult["usage"],
	startTime: number,
	reasoningChunkCount: number,
	redactedReasoningChunkCount: number,
): void {
	if (config.outputMode !== "text") {
		return;
	}
	writeln();
	if (config.verbose) {
		const parts: string[] = [];
		parts.push(`${((performance.now() - startTime) / 1000).toFixed(2)}s`);
		const tokenParts: string[] = [
			`${usage.inputTokens} in`,
			`${usage.outputTokens} out`,
		];
		if (usage.cacheReadTokens) {
			tokenParts.push(`${usage.cacheReadTokens} cache read`);
		}
		if (usage.cacheWriteTokens) {
			tokenParts.push(`${usage.cacheWriteTokens} cache write`);
		}
		parts.push(tokenParts.join(", "));
		if (typeof usage.totalCost === "number") {
			parts.push(`${formatUsd(usage.totalCost)} est. cost`);
		}
		if (result.iterations > 1) {
			parts.push(`${result.iterations} iterations`);
		}
		writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
	}
	if (config.thinking) {
		writeln(
			`${c.dim}[thinking] chunks=${reasoningChunkCount} redacted=${redactedReasoningChunkCount}${c.reset}`,
		);
	}
}

export async function runAgent(
	prompt: string,
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: ProviderSettings;
	},
): Promise<void> {
	// A clean one-shot run should not inherit a stale nonzero process exit code
	// from lower layers or prior bookkeeping inside the same process.
	process.exitCode = 0;

	if (config.verbose) {
		const clineWelcomeLine = await resolveClineWelcomeLine({
			config,
			clineApiBaseUrl: options?.clineApiBaseUrl,
			clineProviderSettings: options?.clineProviderSettings,
		});
		if (clineWelcomeLine && config.outputMode !== "json") {
			writeln(clineWelcomeLine);
		}
	}

	const startTime = performance.now();
	void prewarmFileIndex(config.cwd);

	const sessionManager = await createCliCore({
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
			submit: submitAndExitInTerminal,
		},
		forceLocalBackend: config.mode === "yolo" || config.sandbox === true,
		logger: config.logger,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});
	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: config.mode === "yolo",
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot,
		dispatchHookEvent: async (payload) => {
			await sessionManager.handleHookEvent(payload);
		},
	});

	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;

	const onAgentEvent = (event: AgentEvent): void => {
		if (event.type === "content_start" && event.contentType === "reasoning") {
			reasoningChunkCount += 1;
			if (event.redacted) {
				redactedReasoningChunkCount += 1;
			}
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
			if (activeSessionId) {
				await sessionManager.stop(activeSessionId).catch(() => {});
			}
			await sessionManager.dispose("cli_run_shutdown").catch(() => {});
			await runtimeHooks.shutdown().catch(() => {});
			setActiveRuntimeAbort(undefined);
		})();
		return cleanupDone;
	};

	const handleSigint = () => {
		if (abortAll()) {
			emitAbortRequested(config, "sigint");
			return;
		}
		void cleanupRuntime().finally(() => {
			process.exitCode = 0;
			process.exit(0);
		});
	};
	const handleSigterm = () => {
		if (abortAll()) {
			emitAbortRequested(config, "sigterm");
		}
	};
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	// --- Main execution ---
	try {
		if (config.verbose) {
			printModelProviderInfo(config);
		}
		const {
			prompt: userInput,
			userImages,
			userFiles,
		} = await buildUserInputMessage(prompt, userInstructionWatcher);
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
				userInstructionWatcher,
				onTeamRestored: () => emitTeamRestored(config),
			},
		});

		activeSessionId = started.sessionId;
		setActiveCliSession({
			manifestPath: started.manifestPath,
			messagesPath: started.messagesPath,
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

		const usage =
			(await sessionManager.getAccumulatedUsage(started.sessionId)) ??
			result.usage;

		if (config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "run_result",
				finishReason: result.finishReason,
				iterations: result.iterations,
				usage,
				durationMs: result.durationMs,
				text: result.text,
				model: result.model,
			});
		}

		if (abortRequested || result.finishReason === "aborted") {
			if (timedOut) {
				writeErr(`run timed out after ${config.timeoutSeconds}s`);
				process.exitCode = 1;
			} else if (config.outputMode === "json") {
				emitJsonLine("stdout", {
					type: "run_aborted",
					reason: abortRequested ? "local_abort" : "external_abort",
					message: describeAbortSource({ abortRequested, timedOut }),
				});
			} else {
				writeln(
					`${c.dim}[abort] ${describeAbortSource({ abortRequested, timedOut })}${c.reset}`,
				);
			}
			writeln();
			return;
		}

		if (result.finishReason !== "completed") {
			process.exitCode = 1;
			return;
		}

		printRunStats(
			config,
			result,
			usage,
			startTime,
			reasoningChunkCount,
			redactedReasoningChunkCount,
		);
		process.exitCode = 0;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		config.logger?.log(err instanceof Error ? (err.stack ?? message) : message);
		writeErr(message);
		process.exitCode = 1;
	} finally {
		await cleanupRuntime();
	}
}
