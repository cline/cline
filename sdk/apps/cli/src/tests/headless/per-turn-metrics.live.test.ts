// ---------------------------------------------------------------------------
// Per-turn usage metrics in messages.json — multi-iteration agent loop (@live)
//
// Verifies that each assistant message in messages.json carries its own
// per-turn token usage rather than the session total. This exercises the
// full path: real Agent class → real stream parsing → metrics stamped on
// each assistant message at append time → persisted to messages.json.
//
// The cassette has two API calls:
//   Turn 1: tool call (execute_command)  — usage: 1000 in / 25 out / 50 cacheWrite / 200 cacheRead
//   Turn 2: text completion              — usage: 1500 in / 40 out / 30 cacheWrite / 900 cacheRead
//
// If the bug regresses (session total stamped on terminal message instead of
// per-turn values), turn 2's metrics will equal 2500/65/80/1100 instead of
// 1500/40/30/900, and the assertions will catch it.
// ---------------------------------------------------------------------------

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@microsoft/tui-test";
import {
	CLINE_BIN,
	EXIT_CODE_SUCCESS,
	TERMINAL_WIDE,
} from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectExitCode, expectVisible } from "../helpers/terminal.js";

function findMessagesArtifacts(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const next = stack.pop();
		if (!next) continue;
		for (const entry of readdirSync(next, { withFileTypes: true })) {
			const fullPath = join(next, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".messages.json")) {
				out.push(fullPath);
			}
		}
	}
	return out.sort();
}

test.describe("per-turn metrics in messages.json — multi-iteration @live", () => {
	const sessionDataDir = mkdtempSync(join(tmpdir(), "cline-per-turn-metrics-"));
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--json", "run echo hello then summarize"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/per-turn-metrics.json",
			CLINE_SESSION_DATA_DIR: sessionDataDir,
		}),
	});

	test("each assistant message carries its own per-turn metrics, not the session total", async ({
		terminal,
	}) => {
		await expectVisible(terminal, /\{.*"type"/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);

		const files = findMessagesArtifacts(sessionDataDir);
		if (files.length === 0) {
			throw new Error(`No messages artifacts found in ${sessionDataDir}`);
		}

		const parsed = JSON.parse(
			readFileSync(files[files.length - 1] as string, "utf8"),
		) as { messages?: Array<Record<string, unknown>> };

		const assistants = (parsed.messages ?? []).filter(
			(m) => m?.role === "assistant",
		);

		if (assistants.length < 2) {
			throw new Error(
				`Expected at least 2 assistant messages (one per loop iteration), got ${assistants.length}`,
			);
		}

		type Metrics = {
			inputTokens?: number;
			outputTokens?: number;
			cacheReadTokens?: number;
			cacheWriteTokens?: number;
			cost?: number;
		};

		const m1 = (assistants[0] as Record<string, unknown>).metrics as
			| Metrics
			| undefined;
		const m2 = (assistants[assistants.length - 1] as Record<string, unknown>)
			.metrics as Metrics | undefined;

		// Both messages must have metrics stamped.
		if (typeof m1?.inputTokens !== "number") {
			throw new Error(
				`First assistant message missing inputTokens: ${JSON.stringify(assistants[0])}`,
			);
		}
		if (typeof m2?.inputTokens !== "number") {
			throw new Error(
				`Terminal assistant message missing inputTokens: ${JSON.stringify(assistants[assistants.length - 1])}`,
			);
		}

		// Turn 1 cassette: 1000 prompt_tokens / 25 completion_tokens
		if (m1.inputTokens !== 1000) {
			throw new Error(
				`First assistant message: expected inputTokens=1000 (per-turn), got ${m1.inputTokens}`,
			);
		}
		if (m1.outputTokens !== 25) {
			throw new Error(
				`First assistant message: expected outputTokens=25 (per-turn), got ${m1.outputTokens}`,
			);
		}

		// Turn 2 cassette: 1500 prompt_tokens / 40 completion_tokens
		// If regressed: terminal message would show session totals (2500 in / 65 out).
		if (m2.inputTokens !== 1500) {
			throw new Error(
				`Terminal assistant message: expected inputTokens=1500 (per-turn), got ${m2.inputTokens}. ` +
					`If this is 2500, session totals are being stamped instead of per-turn values.`,
			);
		}
		if (m2.outputTokens !== 40) {
			throw new Error(
				`Terminal assistant message: expected outputTokens=40 (per-turn), got ${m2.outputTokens}. ` +
					`If this is 65, session totals are being stamped instead of per-turn values.`,
			);
		}
	});
});
