import type { AgentEvent } from "@clinebot/agents";
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
	const modelSource = config.knownModels ? "live" : "bundled";
	const thinkingStatus = config.thinking ? "on" : "off";
	const mode = config.mode;
	if (config.outputMode === "json") {
		emitJsonLine("stdout", {
			type: "run_start",
			providerId: config.providerId,
			modelId: config.modelId,
			catalog: modelSource,
			thinking: thinkingStatus,
			mode,
			sessionId: getActiveCliSession()?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${config.providerId} model=${config.modelId} catalog=${modelSource} thinking=${thinkingStatus} mode=${mode}${c.reset}\n`,
	);
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
	if (clineWelcomeLine) {
		writeln(clineWelcomeLine);
	}
	const startTime = performance.now();
	void prewarmFileIndex(config.cwd);
	const runtimeHooks = createRuntimeHooks({
		verbose: config.verbose,
		yolo: config.yolo,
	});
	const sessionManager = await createDefaultCliSessionManager({
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
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
	let abortRequested = false;
	let activeSessionId: string | undefined;
	let cleanupPromise: Promise<void> | undefined;
	const cleanupRuntime = async () => {
		if (cleanupPromise) {
			return await cleanupPromise;
		}
		cleanupPromise = (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			unsubscribe();
			try {
				if (activeSessionId) {
					await sessionManager.stop(activeSessionId);
				}
			} finally {
				try {
					await sessionManager.dispose("cli_run_shutdown");
				} finally {
					await runtimeHooks.shutdown();
				}
			}
			setActiveRuntimeAbort(undefined);
		})();
		return await cleanupPromise;
	};
	const abortAll = () => {
		if (abortRequested) {
			return false;
		}
		abortRequested = true;
		if (activeSessionId) {
			void sessionManager.abort(activeSessionId);
		}
		return true;
	};
	setActiveRuntimeAbort(abortAll);
	const handleSigint = () => {
		if (abortAll()) {
			if (config.outputMode === "json") {
				emitJsonLine("stdout", {
					type: "run_abort_requested",
					reason: "sigint",
				});
				return;
			}
			writeln(`\n${c.dim}[abort] requested${c.reset}`);
			return;
		}
		void cleanupRuntime().finally(() => {
			process.exitCode = 130;
			process.exit(130);
		});
	};
	const handleSigterm = () => {
		if (abortAll() && config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "run_abort_requested",
				reason: "sigterm",
			});
		}
	};
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	let runFailed = false;
	let timedOut = false;
	try {
		printModelProviderInfo(config);
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
			onTeamRestored: () => {
				if (config.outputMode === "json") {
					emitJsonLine("stdout", {
						type: "team_restored",
						teamName: config.teamName ?? "(unknown team)",
					});
					return;
				}
				writeln(
					`${c.dim}[team] restored persisted team state for "${config.teamName ?? "(unknown team)"}"${c.reset}`,
				);
			},
		});
		activeSessionId = started.sessionId;
		setActiveCliSession({
			manifestPath: started.manifestPath,
			transcriptPath: started.transcriptPath,
			hookPath: started.hookPath,
			messagesPath: started.messagesPath,
			manifest: started.manifest,
		});
		let timeoutId: NodeJS.Timeout | undefined;
		if (
			typeof config.timeoutSeconds === "number" &&
			Number.isFinite(config.timeoutSeconds) &&
			config.timeoutSeconds > 0
		) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				abortAll();
			}, config.timeoutSeconds * 1000);
		}
		const result = await sessionManager
			.send({
				sessionId: started.sessionId,
				prompt: userInput,
			})
			.finally(() => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
			});
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
					message: describeAbortSource({
						abortRequested,
						timedOut,
					}),
				});
			} else {
				writeln(
					`${c.dim}[abort] ${describeAbortSource({
						abortRequested,
						timedOut,
					})}${c.reset}`,
				);
			}
			writeln();
			return;
		}

		if (config.outputMode === "text") {
			writeln();
		}

		if (
			config.outputMode === "text" &&
			(config.showTimings || config.showUsage)
		) {
			const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
			const parts: string[] = [];

			if (config.showTimings) {
				parts.push(`${elapsed}s`);
			}

			if (config.showUsage) {
				const tokens = usage.inputTokens + usage.outputTokens;
				parts.push(`${tokens} tokens`);
				if (typeof usage.totalCost === "number") {
					parts.push(`${formatUsd(usage.totalCost)} est. cost`);
				}
				if (result.iterations > 1) {
					parts.push(`${result.iterations} iterations`);
				}
			}

			writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
		}
		if (config.outputMode === "text" && config.thinking) {
			writeln(
				`${c.dim}[thinking] chunks=${reasoningChunkCount} redacted=${redactedReasoningChunkCount}${c.reset}`,
			);
		}
	} catch (err) {
		runFailed = true;
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
	if (runFailed) {
		return;
	}
}
