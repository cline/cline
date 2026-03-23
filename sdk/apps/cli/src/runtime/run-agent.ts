import type { AgentEvent, AgentResult } from "@clinebot/agents";
import {
	type LlmsProviders,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@clinebot/core/node";
import { askQuestionInTerminal, requestToolApproval } from "../utils/approval";
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
import { createDefaultCliSessionManager } from "../utils/session";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import { describeAbortSource, resolveMistakeLimitDecision } from "./format";
import { resolveClineWelcomeLine } from "./interactive-welcome";
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
	if (config.showTimings || config.showUsage) {
		const parts: string[] = [];
		if (config.showTimings) {
			parts.push(`${((performance.now() - startTime) / 1000).toFixed(2)}s`);
		}
		if (config.showUsage) {
			parts.push(`${usage.inputTokens + usage.outputTokens} tokens`);
			if (typeof usage.totalCost === "number") {
				parts.push(`${formatUsd(usage.totalCost)} est. cost`);
			}
			if (result.iterations > 1) {
				parts.push(`${result.iterations} iterations`);
			}
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
		clineProviderSettings?: LlmsProviders.ProviderSettings;
	},
): Promise<void> {
	const clineWelcomeLine = await resolveClineWelcomeLine({
		config,
		clineApiBaseUrl: options?.clineApiBaseUrl,
		clineProviderSettings: options?.clineProviderSettings,
	});
	if (clineWelcomeLine && config.outputMode !== "json") {
		writeln(clineWelcomeLine);
	}

	const startTime = performance.now();
	void prewarmFileIndex(config.cwd);

	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: config.yolo,
	});
	const sessionManager = await createDefaultCliSessionManager({
		defaultToolExecutors: { askQuestion: askQuestionInTerminal },
		logger: config.logger,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});

	let errorAlreadyReported = false;
	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;

	const onAgentEvent = (event: AgentEvent) => {
		if (event.type === "error") {
			errorAlreadyReported = true;
		}
		if (event.type === "content_start" && event.contentType === "reasoning") {
			reasoningChunkCount += 1;
			if (event.redacted) {
				redactedReasoningChunkCount += 1;
			}
		}
		handleEvent(event, config);
	};
	const unsubscribe = subscribeToAgentEvents(sessionManager, onAgentEvent);

	// --- Abort & signal handling ---
	let abortRequested = false;
	let timedOut = false;
	let activeSessionId: string | undefined;

	const abortAll = () => {
		if (abortRequested) return false;
		abortRequested = true;
		if (activeSessionId) {
			void sessionManager.abort(activeSessionId);
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
			await runtimeHooks.shutdown();
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
			process.exitCode = 130;
			process.exit(130);
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
		const userInput = await buildUserInputMessage(
			prompt,
			userInstructionWatcher,
		);
		const started = await sessionManager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				hooks: runtimeHooks.hooks,
				onTeamEvent: handleTeamEvent,
				onConsecutiveMistakeLimitReached: (context) =>
					resolveMistakeLimitDecision(config, context),
			},
			prompt,
			interactive: false,
			userInstructionWatcher,
			onTeamRestored: () => emitTeamRestored(config),
		});

		activeSessionId = started.sessionId;
		setActiveCliSession({
			manifestPath: started.manifestPath,
			transcriptPath: started.transcriptPath,
			hookPath: started.hookPath,
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
				.send({ sessionId: started.sessionId, prompt: userInput })
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

		printRunStats(
			config,
			result,
			usage,
			startTime,
			reasoningChunkCount,
			redactedReasoningChunkCount,
		);
	} catch (err) {
		if (config.outputMode === "text") {
			writeln();
		}
		if (!errorAlreadyReported) {
			writeErr(err instanceof Error ? err.message : String(err));
		}
		process.exitCode = 1;
	} finally {
		await cleanupRuntime();
	}
}
