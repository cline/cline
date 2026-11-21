import { writeFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { getAllProviders } from "@cline/llms/browser";
import {
	type AgentPlugin,
	createTool,
	resolvePluginRuntimeDirectory,
} from "@cline/sdk";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { AUTH_ERROR_PATTERNS, isLikelyAuthError } from "@cline/shared/types";

export default {
	name: "embedded-smoke",
	manifest: { capabilities: ["tools"] },
	async setup(api) {
		if (
			typeof CLINE_DEFAULT_MODEL_ID !== "string" ||
			typeof getAllProviders !== "function"
		) {
			throw new Error("Missing browser SDK exports");
		}
		if (
			!AUTH_ERROR_PATTERNS.includes("unauthorized") ||
			!isLikelyAuthError(new Error("401 Unauthorized"))
		) {
			throw new Error("Missing shared/types runtime exports");
		}
		if (!process.execArgv.includes("--use-system-ca")) {
			throw new Error("Plugin runtime lost compiled system CA trust");
		}
		const runtime = resolvePluginRuntimeDirectory();
		const bunfsRoot =
			process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
		if (!runtime?.replaceAll("\\", "/").startsWith(bunfsRoot)) {
			throw new Error(`Expected the embedded runtime, got ${runtime}`);
		}
		const marker = process.env.CLINE_TEST_PLUGIN_RESULT_PATH;
		if (!marker) {
			throw new Error("Missing CLINE_TEST_PLUGIN_RESULT_PATH");
		}
		// Avoid blocking the plugin worker while its child starts and exits.
		const nested = Bun.spawn([process.execPath, "--telemetry-selfcheck"], {
			env: process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			nested.kill("SIGKILL");
		}, 10_000);
		try {
			const [status, stdout, stderr] = await Promise.all([
				nested.exited,
				new Response(nested.stdout).text(),
				new Response(nested.stderr).text(),
			]);
			if (timedOut)
				throw new Error(`Telemetry selfcheck exceeded 10 seconds: ${stderr}`);
			if (status !== 0)
				throw new Error(
					stderr || `Telemetry selfcheck exited with code ${status}`,
				);
			JSON.parse(stdout);
		} finally {
			clearTimeout(timer);
			if (nested.exitCode === null) nested.kill("SIGKILL");
			await nested.exited;
		}
		const tool = createTool({
			name: "embedded_ping",
			description: "Packaged SDK tool",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({
				pong: true,
				execPath: process.execPath,
				isMainThread,
				bunRuntimeFlag: process.env.BUN_BE_BUN ?? null,
			}),
		});
		writeFileSync(
			marker,
			JSON.stringify(
				await tool.execute({}, { agentId: "embedded-smoke", iteration: 0 }),
			),
		);
		api.registerTool(tool);
	},
} satisfies AgentPlugin;
