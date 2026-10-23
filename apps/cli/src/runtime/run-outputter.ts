import type { AgentResult } from "@cline/core";
import { c, emitJsonLine, formatUsd, writeErr, writeln } from "../utils/output";
import type { Config } from "../utils/types";
import { shouldShowCliUsageCost } from "../utils/usage-cost-display";
import { describeAbortSource } from "./format";

export interface RunFinishedOptions {
	result: AgentResult;
	usage: AgentResult["usage"];
	startTime: number;
	reasoningChunkCount: number;
	redactedReasoningChunkCount: number;
}

export interface RunAbortedOptions {
	abortRequested: boolean;
	timedOut: boolean;
	timeoutSeconds?: number;
}

export interface RunOutputter {
	readonly verbose: boolean;
	welcome(message: string): void;
	runStarted(sessionId: string): void;
	abortRequested(reason: "sigint" | "sigterm"): void;
	teamRestored(teamName: string): void;
	runResult(
		result: AgentResult,
		usage: AgentResult["usage"],
		aggregateUsage?: AgentResult["usage"],
	): void;
	runAborted(options: RunAbortedOptions): void;
	runFinished(options: RunFinishedOptions): void;
	reportError(message: string, alreadyDisplayed?: boolean): void;
	blankLine(): void;
}

export class JsonRunOutputter implements RunOutputter {
	readonly verbose: boolean;

	constructor(private readonly config: Config) {
		this.verbose = config.verbose;
	}

	welcome(_message: string): void {}

	runStarted(sessionId: string): void {
		const catalog = this.config.knownModels ? "live" : "bundled";
		const thinking = this.config.thinking ? "on" : "off";
		const { mode, providerId, modelId } = this.config;

		// The active session is only registered after sessionManager.start()
		// resolves, so run_start must use the session ID planned for this run.
		emitJsonLine("stdout", {
			type: "run_start",
			providerId,
			modelId,
			catalog,
			thinking,
			mode,
			sessionId,
		});
	}

	abortRequested(reason: "sigint" | "sigterm"): void {
		emitJsonLine("stdout", { type: "run_abort_requested", reason });
	}

	teamRestored(teamName: string): void {
		emitJsonLine("stdout", { type: "team_restored", teamName });
	}

	runResult(
		result: AgentResult,
		usage: AgentResult["usage"],
		aggregateUsage?: AgentResult["usage"],
	): void {
		emitJsonLine("stdout", {
			type: "run_result",
			finishReason: result.finishReason,
			iterations: result.iterations,
			usage,
			...(aggregateUsage ? { aggregateUsage } : {}),
			durationMs: result.durationMs,
			text: result.text,
			model: result.model,
		});
	}

	runAborted(options: RunAbortedOptions): void {
		if (options.timedOut) {
			writeErr(`run timed out after ${options.timeoutSeconds}s`);
			return;
		}
		emitJsonLine("stdout", {
			type: "run_aborted",
			reason: options.abortRequested ? "local_abort" : "external_abort",
			message: describeAbortSource(options),
		});
	}

	runFinished(_options: RunFinishedOptions): void {}

	reportError(message: string, _alreadyDisplayed = false): void {
		writeErr(message);
	}

	blankLine(): void {}
}

export class ConsoleRunOutputter implements RunOutputter {
	readonly verbose: boolean;

	constructor(private readonly config: Config) {
		this.verbose = config.verbose;
	}

	welcome(message: string): void {
		if (this.verbose) {
			writeln(message);
		}
	}

	runStarted(_sessionId: string): void {
		if (!this.verbose) {
			return;
		}
		const catalog = this.config.knownModels ? "live" : "bundled";
		const thinking = this.config.thinking ? "on" : "off";
		const { mode, providerId, modelId } = this.config;
		writeln(
			`${c.dim}[model] provider=${providerId} model=${modelId} catalog=${catalog} thinking=${thinking} mode=${mode}${c.reset}\n`,
		);
	}

	abortRequested(reason: "sigint" | "sigterm"): void {
		if (reason === "sigint") {
			writeln(`\n${c.dim}[abort] requested${c.reset}`);
		}
	}

	teamRestored(teamName: string): void {
		writeln(
			`${c.dim}[team] restored persisted team state for "${teamName}"${c.reset}`,
		);
	}

	runResult(
		_result: AgentResult,
		_usage: AgentResult["usage"],
		_aggregateUsage?: AgentResult["usage"],
	): void {}

	runAborted(options: RunAbortedOptions): void {
		if (options.timedOut) {
			writeErr(`run timed out after ${options.timeoutSeconds}s`);
			return;
		}
		writeln(`${c.dim}[abort] ${describeAbortSource(options)}${c.reset}`);
	}

	runFinished(options: RunFinishedOptions): void {
		if (!this.verbose) {
			return;
		}
		const { result, usage, startTime } = options;
		writeln();
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
		if (
			shouldShowCliUsageCost(this.config.providerId) &&
			typeof usage.totalCost === "number"
		) {
			parts.push(`${formatUsd(usage.totalCost)} est. cost`);
		}
		if (result.iterations > 1) {
			parts.push(`${result.iterations} iterations`);
		}
		writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
		if (this.config.thinking) {
			writeln(
				`${c.dim}[thinking] chunks=${options.reasoningChunkCount} redacted=${options.redactedReasoningChunkCount}${c.reset}`,
			);
		}
	}

	reportError(message: string, alreadyDisplayed = false): void {
		if (!alreadyDisplayed) {
			writeErr(message);
		}
	}

	blankLine(): void {
		writeln();
	}
}

export function createRunOutputter(config: Config): RunOutputter {
	return config.outputMode === "json"
		? new JsonRunOutputter(config)
		: new ConsoleRunOutputter(config);
}
