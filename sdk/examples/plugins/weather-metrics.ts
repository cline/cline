/**
 * Custom Plugin Example
 *
 * Shows how to author a reusable plugin module for the CLI and SDK hosts.
 *
 * Demonstrates:
 *   - setup(api, ctx)      — workspace-aware tool registration via
 *                            ctx.workspaceInfo
 *   - hooks.beforeRun / beforeTool / afterTool / afterRun — lifecycle metrics
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp examples/plugins/weather-plugin.example.ts .cline/plugins/weather-metrics.ts
 *   cline -i "What's the weather like in Tokyo and Paris?"
 *
 * Direct demo usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/plugins/weather-plugin.example.ts
 */

import { type AgentPlugin, ClineCore, createTool } from "@cline/core";

// ---------------------------------------------------------------------------
// Plugin-level state — populated from setup context and available to all hook
// handlers and tool executors for the duration of the session.
// ---------------------------------------------------------------------------

let sessionWorkspaceRoot: string | undefined;
let sessionBranch: string | undefined;
let sessionCommit: string | undefined;

const plugin: AgentPlugin = {
	name: "weather-and-metrics",
	manifest: {
		capabilities: ["tools", "hooks"],
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
	// Use setup context for session-scoped plugin state.
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
		sessionWorkspaceRoot = ctx.workspaceInfo?.rootPath;
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
	},

	// -------------------------------------------------------------------------
	// Lifecycle metrics hooks
	// -------------------------------------------------------------------------
	hooks: {
		beforeRun() {
			console.log("\n[metrics] run started");
			return undefined;
		},

		beforeTool({ toolCall, input }) {
			console.log(`[metrics] -> ${toolCall.toolName}`, input);

			if (toolCall.toolName === "run_commands") {
				const { commands } = input as { commands?: string[] };
				const isProtected =
					sessionBranch === "main" || sessionBranch === "master";
				const hasPush = commands?.some((c) =>
					c.trimStart().startsWith("git push"),
				);
				if (isProtected && hasPush) {
					console.error(
						`[metrics] blocked: git push on protected branch "${sessionBranch}"`,
					);
					return { stop: true, reason: "Blocked git push on protected branch" };
				}
			}
			return undefined;
		},

		afterTool({ toolCall }) {
			console.log(`[metrics] <- ${toolCall.toolName}`);
			return undefined;
		},

		afterRun({ result }) {
			const { status, iterations, usage } = result;
			const loc = sessionWorkspaceRoot ? ` in ${sessionWorkspaceRoot}` : "";
			console.log(
				`[metrics] run done${loc} — ${iterations} iteration(s), status: ${status}`,
			);
			console.log(
				`[metrics] tokens — in: ${usage.inputTokens}, out: ${usage.outputTokens}, cost: ${usage.totalCost?.toFixed(6)}`,
			);
		},
	},
};

async function runDemo(): Promise<void> {
	const sessionManager = await ClineCore.create({ backendMode: "local" });

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
				// workspaceInfo that flows into setup(api, ctx). The CLI
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
