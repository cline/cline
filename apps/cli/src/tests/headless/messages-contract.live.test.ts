// ---------------------------------------------------------------------------
// CLI headless persisted artifact contract (@live)
//
// This file intentionally isolates persisted-artifact assertions so it can be
// executed independently of the broader headless suite.
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
	if (!existsSync(root)) {
		return [];
	}
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

test.describe("cline --json persisted messages contract - authenticated @live", () => {
	const sessionDataDir = mkdtempSync(
		join(tmpdir(), "cline-headless-messages-contract-"),
	);
	test.use({
		program: { file: CLINE_BIN, args: ["--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-json.json",
			CLINE_SESSION_DATA_DIR: sessionDataDir,
		}),
	});

	test("persists assistant modelInfo and full metrics in messages artifact", async ({
		terminal,
	}) => {
		await expectVisible(terminal, /\{.*"type"/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);

		const files = findMessagesArtifacts(sessionDataDir);
		if (files.length === 0) {
			throw new Error(`No messages artifacts found in ${sessionDataDir}`);
		}
		const artifactPath = files[files.length - 1] as string;
		const parsed = JSON.parse(readFileSync(artifactPath, "utf8")) as {
			messages?: Array<Record<string, unknown>>;
		};
		if (!Array.isArray(parsed.messages)) {
			throw new Error(`messages array missing in artifact: ${artifactPath}`);
		}
		const messages = parsed.messages ?? [];
		const assistantMessages = messages.filter(
			(message) => message?.role === "assistant",
		);
		if (assistantMessages.length === 0) {
			throw new Error(`No assistant messages in artifact: ${artifactPath}`);
		}

		for (const assistant of assistantMessages) {
			const modelInfo = assistant.modelInfo as
				| { id?: unknown; provider?: unknown }
				| undefined;
			if (typeof modelInfo?.id !== "string") {
				throw new Error(
					`assistant modelInfo.id missing in artifact: ${artifactPath}`,
				);
			}
			if (typeof modelInfo?.provider !== "string") {
				throw new Error(
					`assistant modelInfo.provider missing in artifact: ${artifactPath}`,
				);
			}
		}

		const metricsCarrier = assistantMessages.find((assistant) => {
			const metrics = assistant.metrics as
				| {
						inputTokens?: unknown;
						outputTokens?: unknown;
						cacheReadTokens?: unknown;
						cacheWriteTokens?: unknown;
						cost?: unknown;
				  }
				| undefined;
			return (
				typeof metrics?.inputTokens === "number" &&
				typeof metrics.outputTokens === "number" &&
				typeof metrics.cacheReadTokens === "number" &&
				typeof metrics.cacheWriteTokens === "number" &&
				typeof metrics.cost === "number"
			);
		});
		if (!metricsCarrier) {
			throw new Error(
				`No assistant message with full metrics found in artifact: ${artifactPath}`,
			);
		}
	});
});
