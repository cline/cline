/**
 * Custom Plugin Example
 *
 * Shows how to author a reusable plugin module for the CLI and SDK hosts.
 *
 * Demonstrates:
 *   - setup(api, ctx)      — workspace-aware tool registration via
 *                            ctx.workspaceInfo
 *   - hooks.beforeRun / beforeTool / afterTool / afterRun — lifecycle metrics
 *   - ctx.telemetry        — emitting plugin telemetry into the host's
 *                            telemetry service
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/weather-metrics.ts --cwd .
 *   cline -i "What's the weather like in Tokyo and Paris?"
 *
 * Direct demo usage:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/plugins/weather-metrics.ts
 */

import {
	type AgentPlugin,
	createTool,
	type ITelemetryService,
} from "@cline/core";

// ---------------------------------------------------------------------------
// Plugin-level state — populated from setup context and available to all hook
// handlers and tool executors for the duration of the session.
// ---------------------------------------------------------------------------

let sessionWorkspaceRoot: string | undefined;
let sessionBranch: string | undefined;
let sessionCommit: string | undefined;
let telemetry: ITelemetryService | undefined;
let toolCallCount = 0;

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

		// ctx.telemetry routes into the host's telemetry service. Always
		// feature-detect it: it is undefined when the host has no telemetry
		// service. In the plugin sandbox it is a bridge — events cross the
		// process boundary as JSON, so pass only plain data (strings, numbers,
		// booleans), never live objects. The host namespaces every event under
		// `plugin.` and stamps it with this plugin's name.
		//
		// Note: in the sandbox, isEnabled() always reports true — the host
		// decides whether telemetry is on and drops opted-out events on its
		// side. So don't gate expensive property computation on isEnabled();
		// keep properties cheap to build, like the flags below.
		telemetry = ctx.telemetry;
		telemetry?.capture({
			event: "weather_plugin_setup",
			properties: {
				has_workspace: Boolean(sessionWorkspaceRoot),
				branch: sessionBranch,
			},
		});

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
			toolCallCount += 1;
			// Counters/histograms/gauges work too; the host prefixes the metric
			// name with `plugin.` and adds a plugin_name attribute.
			telemetry?.recordCounter("weather_plugin.tool_calls", 1, {
				tool_name: toolCall.toolName,
			});

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
			telemetry?.capture({
				event: "weather_plugin_run_completed",
				properties: {
					status,
					iterations,
					tool_calls: toolCallCount,
					input_tokens: usage.inputTokens,
					output_tokens: usage.outputTokens,
				},
			});
		},
	},
};

export { plugin };
export default plugin;
