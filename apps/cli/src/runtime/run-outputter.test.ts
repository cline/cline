import type { AgentResult } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";
import {
	ConsoleRunOutputter,
	createRunOutputter,
	JsonRunOutputter,
} from "./run-outputter";

const outputMocks = vi.hoisted(() => ({
	writeln: vi.fn(),
	writeErr: vi.fn(),
	emitJsonLine: vi.fn(),
	formatUsd: vi.fn(() => "$1.23"),
	c: { dim: "", reset: "" },
}));

vi.mock("../utils/output", () => outputMocks);
vi.mock("../utils/usage-cost-display", () => ({
	shouldShowCliUsageCost: () => true,
}));

function buildConfig(overrides: Partial<Config> = {}): Config {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet",
		apiKey: "test-key",
		verbose: false,
		sandbox: false,
		outputMode: "text",
		mode: "act",
		thinking: false,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		...overrides,
	} as Config;
}

function buildUsage() {
	return {
		inputTokens: 10,
		outputTokens: 20,
		cacheReadTokens: 3,
		cacheWriteTokens: 4,
		totalCost: 1.23,
	};
}

function buildResult(): AgentResult {
	return {
		finishReason: "completed",
		iterations: 2,
		durationMs: 2500,
		text: "done",
		model: {
			id: "claude-sonnet",
			provider: "anthropic",
			info: { id: "claude-sonnet" },
		},
		usage: buildUsage(),
		messages: [],
		toolCalls: [],
		startedAt: new Date(0),
		endedAt: new Date(2500),
	} as AgentResult;
}

function resetOutputMocks(): void {
	vi.clearAllMocks();
	outputMocks.formatUsd.mockReturnValue("$1.23");
}

describe("JsonRunOutputter", () => {
	let output: JsonRunOutputter;

	beforeEach(() => {
		resetOutputMocks();
		output = new JsonRunOutputter(
			buildConfig({ outputMode: "json", verbose: false }),
		);
	});

	it.each([
		false,
		true,
	])("emits run_start with the given session id when verbose=%s", (verbose) => {
		output = new JsonRunOutputter(buildConfig({ outputMode: "json", verbose }));

		output.runStarted("planned-session");

		expect(outputMocks.emitJsonLine).toHaveBeenCalledWith(
			"stdout",
			expect.objectContaining({
				type: "run_start",
				sessionId: "planned-session",
			}),
		);
		expect(outputMocks.writeln).not.toHaveBeenCalled();
	});

	it("never writes the welcome text", () => {
		output.welcome("welcome");

		expect(outputMocks.writeln).not.toHaveBeenCalled();
	});

	it("emits abortRequested and teamRestored as JSON events", () => {
		output.abortRequested("sigterm");
		output.teamRestored("team-a");

		expect(outputMocks.emitJsonLine).toHaveBeenNthCalledWith(1, "stdout", {
			type: "run_abort_requested",
			reason: "sigterm",
		});
		expect(outputMocks.emitJsonLine).toHaveBeenNthCalledWith(2, "stdout", {
			type: "team_restored",
			teamName: "team-a",
		});
	});

	it("emits run_result and only includes aggregate usage when provided", () => {
		const result = buildResult();
		const usage = buildUsage();
		const aggregateUsage = buildUsage();

		output.runResult(result, usage);
		output.runResult(result, usage, aggregateUsage);

		expect(outputMocks.emitJsonLine).toHaveBeenNthCalledWith(
			1,
			"stdout",
			expect.objectContaining({ type: "run_result", usage }),
		);
		expect(outputMocks.emitJsonLine).toHaveBeenNthCalledWith(
			1,
			"stdout",
			expect.not.objectContaining({ aggregateUsage: expect.anything() }),
		);
		expect(outputMocks.emitJsonLine).toHaveBeenNthCalledWith(
			2,
			"stdout",
			expect.objectContaining({
				type: "run_result",
				usage,
				aggregateUsage,
			}),
		);
	});

	it("writes a timeout error and no run_aborted event", () => {
		output.runAborted({
			abortRequested: true,
			timedOut: true,
			timeoutSeconds: 30,
		});

		expect(outputMocks.writeErr).toHaveBeenCalledWith(
			"run timed out after 30s",
		);
		expect(outputMocks.emitJsonLine).not.toHaveBeenCalled();
	});

	it.each([
		[true, "local_abort"],
		[false, "external_abort"],
	] as const)("emits run_aborted with the right reason when abortRequested=%s", (abortRequested, reason) => {
		output.runAborted({ abortRequested, timedOut: false });

		expect(outputMocks.emitJsonLine).toHaveBeenCalledWith(
			"stdout",
			expect.objectContaining({ type: "run_aborted", reason }),
		);
		expect(outputMocks.writeErr).not.toHaveBeenCalled();
	});

	it("does not print run summary statistics", () => {
		output.runFinished({
			result: buildResult(),
			usage: buildUsage(),
			startTime: 0,
			reasoningChunkCount: 1,
			redactedReasoningChunkCount: 0,
		});

		expect(outputMocks.writeln).not.toHaveBeenCalled();
		expect(outputMocks.emitJsonLine).not.toHaveBeenCalled();
	});

	it("always writes errors, even when already displayed", () => {
		output.reportError("terminal error", true);
		output.reportError("fresh error", false);

		expect(outputMocks.writeErr).toHaveBeenNthCalledWith(1, "terminal error");
		expect(outputMocks.writeErr).toHaveBeenNthCalledWith(2, "fresh error");
	});

	it("does not emit a blank line", () => {
		output.blankLine();

		expect(outputMocks.writeln).not.toHaveBeenCalled();
		expect(outputMocks.emitJsonLine).not.toHaveBeenCalled();
	});
});

describe("ConsoleRunOutputter", () => {
	beforeEach(() => {
		resetOutputMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		false,
		true,
	])("writes welcome text only when verbose=%s", (verbose) => {
		const output = new ConsoleRunOutputter(buildConfig({ verbose }));

		output.welcome("welcome");

		if (verbose) {
			expect(outputMocks.writeln).toHaveBeenCalledWith("welcome");
		} else {
			expect(outputMocks.writeln).not.toHaveBeenCalled();
		}
	});

	it.each([
		false,
		true,
	])("writes the model diagnostic only when verbose=%s", (verbose) => {
		const output = new ConsoleRunOutputter(buildConfig({ verbose }));

		output.runStarted("session-1");

		if (verbose) {
			expect(outputMocks.writeln).toHaveBeenCalledWith(
				expect.stringContaining(
					"[model] provider=anthropic model=claude-sonnet catalog=bundled thinking=off mode=act",
				),
			);
		} else {
			expect(outputMocks.writeln).not.toHaveBeenCalled();
		}
	});

	it("writes abort feedback for SIGINT only", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.abortRequested("sigterm");
		expect(outputMocks.writeln).not.toHaveBeenCalled();

		output.abortRequested("sigint");
		expect(outputMocks.writeln).toHaveBeenCalledWith(
			expect.stringContaining("[abort] requested"),
		);
	});

	it("writes the restored team message", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.teamRestored("team-a");

		expect(outputMocks.writeln).toHaveBeenCalledWith(
			expect.stringContaining('restored persisted team state for "team-a"'),
		);
	});

	it("does not print run result JSON in text mode", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.runResult(buildResult(), buildUsage(), buildUsage());

		expect(outputMocks.writeln).not.toHaveBeenCalled();
		expect(outputMocks.emitJsonLine).not.toHaveBeenCalled();
	});

	it("writes a timeout error and no abort line", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.runAborted({
			abortRequested: true,
			timedOut: true,
			timeoutSeconds: 30,
		});

		expect(outputMocks.writeErr).toHaveBeenCalledWith(
			"run timed out after 30s",
		);
		expect(outputMocks.writeln).not.toHaveBeenCalled();
	});

	it("writes the abort source for non-timeout aborts", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.runAborted({ abortRequested: false, timedOut: false });

		expect(outputMocks.writeln).toHaveBeenCalledWith(
			expect.stringContaining("[abort] aborted by another client"),
		);
	});

	it.each([
		false,
		true,
	])("writes run statistics only when verbose=%s", (verbose) => {
		vi.spyOn(performance, "now").mockReturnValue(2500);
		const output = new ConsoleRunOutputter(
			buildConfig({ verbose, thinking: verbose }),
		);

		output.runFinished({
			result: buildResult(),
			usage: buildUsage(),
			startTime: 0,
			reasoningChunkCount: 7,
			redactedReasoningChunkCount: 2,
		});

		if (!verbose) {
			expect(outputMocks.writeln).not.toHaveBeenCalled();
			return;
		}

		expect(outputMocks.writeln).toHaveBeenNthCalledWith(1);
		expect(outputMocks.writeln).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("2.50s"),
		);
		expect(outputMocks.writeln).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("10 in, 20 out, 3 cache read, 4 cache write"),
		);
		expect(outputMocks.writeln).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("$1.23 est. cost"),
		);
		expect(outputMocks.writeln).toHaveBeenNthCalledWith(
			3,
			expect.stringContaining("[thinking] chunks=7 redacted=2"),
		);
	});

	it("suppresses errors that were already displayed", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.reportError("terminal error", true);
		expect(outputMocks.writeErr).not.toHaveBeenCalled();

		output.reportError("fresh error", false);
		expect(outputMocks.writeErr).toHaveBeenCalledWith("fresh error");
	});

	it("writes a blank line", () => {
		const output = new ConsoleRunOutputter(buildConfig());

		output.blankLine();

		expect(outputMocks.writeln).toHaveBeenCalledWith();
	});
});

describe("createRunOutputter", () => {
	it("selects the outputter for the configured mode", () => {
		expect(
			createRunOutputter(buildConfig({ outputMode: "json" })),
		).toBeInstanceOf(JsonRunOutputter);
		expect(
			createRunOutputter(buildConfig({ outputMode: "text" })),
		).toBeInstanceOf(ConsoleRunOutputter);
	});
});
