/**
 * Custom Plugin Example
 *
 * Shows how to author a reusable plugin module for the CLI and SDK hosts.
 *
 * Demonstrates:
 *   - setup(api, ctx)      — workspace-aware tool registration via
 *                            ctx.workspaceInfo
 *   - onSessionStart(ctx)  — session-scoped init; ctx carries the same
 *                            workspace fields including git metadata
 *   - onRunStart / onToolCall / onToolResult / onRunEnd — lifecycle metrics
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp apps/examples/cline-plugin/index.ts .cline/plugins/weather-metrics.ts
 *   clite -i "What's the weather like in Tokyo and Paris?"
 *
 * Direct demo usage:
 *   ANTHROPIC_API_KEY=sk-... bun run apps/examples/cline-plugin/index.ts
 */

import { type AgentPlugin, ClineCore, createTool } from "@clinebot/core";

// ---------------------------------------------------------------------------
// Plugin-level state — populated once in onSessionStart, available to all
// hook handlers and tool executors for the duration of the session.
// ---------------------------------------------------------------------------

let sessionWorkspaceRoot: string | undefined;
let sessionBranch: string | undefined;
let sessionCommit: string | undefined;

const plugin: AgentPlugin = {
	name: "weather-and-metrics",
	manifest: {
		capabilities: ["tools", "hooks"],
		hookStages: [
			"session_start",
			"run_start",
			"tool_call_before",
			"tool_call_after",
			"run_end",
		],
	},

	// -------------------------------------------------------------------------
	// setup(api, ctx)
	//
	// Called once before the first run. The second argument `ctx` provides
	// workspace context sourced directly from the session config — never from
	// process.cwd() or import.meta.url, so it is correct even when --cwd was
	// passed to the CLI without calling process.chdir().
	//
	//   ctx.workspaceInfo — structured workspace + git metadata: rootPath, hint,
	//                       latestGitCommitHash, latestGitBranchName,
	//                       associatedRemoteUrls
	//
	// Use setup() context for anything that affects tool registration itself —
	// e.g. building workspace-relative descriptions or defaulting file paths.
	// For session-scoped side-effects (caching, logging) prefer onSessionStart.
	// -------------------------------------------------------------------------
	setup(api, ctx) {
		// Build a workspace-aware description so the model knows exactly where
		// the tool operates. rootPath covers the workspace location and the
		// remaining workspaceInfo fields add the git layer.
		const root = ctx.workspaceInfo?.rootPath ?? "(unknown)";
		const branch = ctx.workspaceInfo?.latestGitBranchName;
		const locationSuffix = branch
			? ` (workspace: ${root}, branch: ${branch})`
			: ` (workspace: ${root})`;

		api.registerTool(
			createTool({
				name: "get_weather",
				description: `Get the current weather for a city${locationSuffix}`,
				inputSchema: {
					type: "object",
					properties: {
						city: { type: "string", description: "The city name" },
					},
					required: ["city"],
				},
				execute: async (input: unknown) => {
					const { city } = input as { city: string };
					return {
						city,
						temperature: "72°F",
						condition: "sunny",
						humidity: "45%",
					};
				},
			}),
		);
	},

	// -------------------------------------------------------------------------
	// onSessionStart(ctx)
	//
	// Fired exactly once when the session is first initialized, before any run
	// starts. The canonical place for session-scoped initialization.
	//
	// Session hooks receive the wider session workspace envelope:
	//   ctx.cwd            — session working directory
	//   ctx.workspaceRoot  — project/repo root
	//   ctx.workspaceInfo  — structured workspace + git metadata (rootPath,
	//                        branch, commit, associatedRemoteUrls)
	//
	// Unlike process.cwd() — which may return the wrong path when --cwd is
	// used without process.chdir() — these values always match the session
	// config and are safe to use in global plugins or cross-workspace setups.
	// -------------------------------------------------------------------------
	onSessionStart(ctx) {
		// Cache workspace context so all hooks below can reference it without
		// re-reading from disk on every tool call.
		sessionWorkspaceRoot =
			ctx.workspaceInfo?.rootPath ?? ctx.workspaceRoot ?? ctx.cwd;
		sessionBranch = ctx.workspaceInfo?.latestGitBranchName;
		sessionCommit = ctx.workspaceInfo?.latestGitCommitHash?.slice(0, 7);
		const remotes = ctx.workspaceInfo?.associatedRemoteUrls ?? [];

		console.log(`\n[metrics] session started`);
		if (sessionWorkspaceRoot) {
			console.log(`[metrics] workspace : ${sessionWorkspaceRoot}`);
		}
		if (sessionBranch) {
			console.log(
				`[metrics] branch   : ${sessionBranch}${sessionCommit ? ` @ ${sessionCommit}` : ""}`,
			);
		}
		if (remotes.length > 0) {
			console.log(`[metrics] remotes  : ${remotes.join(", ")}`);
		}
		return undefined;
	},

	// -------------------------------------------------------------------------
	// Lifecycle metrics hooks
	// -------------------------------------------------------------------------

	onRunStart({ userMessage }) {
		console.log(`\n[metrics] run started: "${userMessage}"`);
		return undefined;
	},

	onToolCall({ call }) {
		console.log(`[metrics] -> ${call.name}`, call.input);

		// Example policy using context cached from onSessionStart: block
		// "git push" on main/master without shelling out to git again.
		if (call.name === "run_commands") {
			const { commands } = call.input as { commands?: string[] };
			const isProtected =
				sessionBranch === "main" || sessionBranch === "master";
			const hasPush = commands?.some((c) =>
				c.trimStart().startsWith("git push"),
			);
			if (isProtected && hasPush) {
				console.error(
					`[metrics] blocked: git push on protected branch "${sessionBranch}"`,
				);
				return { cancel: true };
			}
		}
		return undefined;
	},

	onToolResult({ record }) {
		console.log(`[metrics] <- ${record.name} (${record.durationMs}ms)`);
		return undefined;
	},

	onRunEnd({ result }) {
		const { finishReason, iterations, usage } = result;
		const loc = sessionWorkspaceRoot ? ` in ${sessionWorkspaceRoot}` : "";
		console.log(
			`[metrics] run done${loc} — ${iterations} iteration(s), reason: ${finishReason}`,
		);
		console.log(
			`[metrics] tokens — in: ${usage.inputTokens}, out: ${usage.outputTokens}, cost: ${usage.totalCost?.toFixed(6)}`,
		);
	},
};

async function runDemo(): Promise<void> {
	const sessionManager = await ClineCore.create({});

	try {
		const result = await sessionManager.start({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY ?? "",
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				systemPrompt: "You are a helpful assistant. Use tools when needed.",
				extensions: [plugin],
				// extensionContext.workspace is the authoritative source for
				// workspaceInfo that flows into setup(api, ctx), and for the wider
				// session workspace fields consumed by onSessionStart(ctx). The CLI
				// and VS Code hosts populate this automatically from their runtime
				// state. When using the SDK directly, set it explicitly so plugins
				// always receive accurate workspace metadata.
				extensionContext: {
					workspace: {
						rootPath: process.cwd(),
						cwd: process.cwd(),
					},
				},
			},
			prompt: "What's the weather like in Tokyo and Paris?",
			interactive: false,
		});

		console.log(`\n${result.result?.text ?? ""}`);
	} finally {
		await sessionManager.dispose();
	}
}

if (import.meta.main) {
	await runDemo();
}

export { plugin, runDemo };
export default plugin;
