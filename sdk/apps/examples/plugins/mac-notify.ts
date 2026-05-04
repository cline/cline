/**
 * macOS Notification Plugin Example
 *
 * Sends a Notification Center alert when a Cline run completes successfully.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp apps/examples/plugins/mac-notify.ts .cline/plugins/mac-notify.ts
 *   cline -i "Run the test suite"
 */

import { execFile } from "node:child_process";
import type { AgentPlugin, AgentRunResult } from "@clinebot/core";

function quoteAppleScriptString(value: string): string {
	return `"${value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\r", " ")
		.replaceAll("\n", " ")
		.slice(0, 220)}"`;
}

function sendMacNotification(title: string, body: string): void {
	if (process.platform !== "darwin") {
		return;
	}

	const script = [
		"display notification",
		quoteAppleScriptString(body),
		"with title",
		quoteAppleScriptString(title),
		"sound name",
		quoteAppleScriptString("Glass"),
	].join(" ");

	execFile("/usr/bin/osascript", ["-e", script], { timeout: 2000 }, () => {
		// Notification failures should never fail or slow down the agent run.
	});
}

function summarizeResult(result: AgentRunResult): string {
	const summary = result.outputText.trim();
	if (summary.length > 0) {
		return summary;
	}
	return `Completed in ${result.iterations} iteration(s).`;
}

const plugin: AgentPlugin = {
	name: "mac-notify-on-complete",
	manifest: {
		capabilities: ["hooks"],
	},

	hooks: {
		afterRun({ result }) {
			if (result.status !== "completed") {
				return;
			}
			sendMacNotification("Cline session completed", summarizeResult(result));
		},
	},
};

export { plugin };
export default plugin;
