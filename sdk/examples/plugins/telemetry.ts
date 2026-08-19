/**
 * Telemetry & Logger Plugin Example
 *
 * The reference example for observability from a plugin. Shows how — and how
 * NOT — to use the two host-provided observability channels on the setup
 * context:
 *
 *   ctx.logger    — structured, session-scoped logging for humans debugging a
 *                   session. Goes to the host's log sink (e.g. the CLI log
 *                   file), tagged with your plugin name.
 *   ctx.telemetry — aggregated product/ops signals for dashboards. Goes to
 *                   the host's telemetry service (events + metrics).
 *
 * The contract, in one place:
 *
 *   1. FEATURE-DETECT BOTH. Each is optional — `ctx.logger?.log(...)`,
 *      `ctx.telemetry?.capture(...)`. They are undefined when the host does
 *      not provide them; your plugin must work without them.
 *
 *   2. PLAIN DATA ONLY. Sandboxed plugins run in a separate process; logger
 *      and telemetry calls are forwarded to the host over JSON IPC. Pass
 *      strings, numbers, and booleans — never sockets, clients, or other live
 *      objects. (One exception: `logger` metadata may include an `error`
 *      value that is an Error instance — the bridge serializes its
 *      name/message/stack for you.)
 *
 *   3. NAMESPACING IS AUTOMATIC. The host prefixes every plugin event and
 *      metric with `plugin.` and stamps a `plugin_name` property/attribute,
 *      so plugins cannot impersonate first-party events. Emit short local
 *      names ("cache_refresh"), not pre-namespaced ones.
 *
 *   4. OPT-OUT IS HANDLED HOST-SIDE. When the user disabled telemetry, the
 *      host drops forwarded events. In the sandbox `isEnabled()` always
 *      reports `true` (the bridge is stateless), so do NOT gate expensive
 *      property computation on it — keep properties cheap to build.
 *
 *   5. LOW CARDINALITY, NO CONTENT. Telemetry properties should be statuses,
 *      names of known presets, durations, counts. Never user prompts, file
 *      contents, tool output, or anything secret — that belongs nowhere, and
 *      free-form text does not aggregate anyway. Detailed context goes to the
 *      logger instead (which stays on the user's machine).
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/telemetry.ts --cwd .
 *   cline -i "Roll a die a few times and tell me your best roll."
 */

import {
	type AgentPlugin,
	type BasicLogger,
	createTool,
	type ITelemetryService,
} from "@cline/core";

// ---------------------------------------------------------------------------
// Plugin-level state
//
// setup() receives the logger and telemetry handles; hooks and background
// work do not. Capture them once at module level. If your host runs multiple
// sessions in one process, key any *data* by ctx.session?.sessionId — the
// handles themselves are safe to share.
// ---------------------------------------------------------------------------

let logger: BasicLogger | undefined;
let telemetry: ITelemetryService | undefined;

let rollCount = 0;
let bestRoll = 0;

const plugin: AgentPlugin = {
	name: "telemetry-demo",
	manifest: { capabilities: ["tools", "hooks"] },

	setup(api, ctx) {
		logger = ctx.logger;
		telemetry = ctx.telemetry;

		// Logger: human-facing, high-detail, session-scoped. The host tags
		// entries with this plugin's name; metadata is structured, not string
		// interpolation, so log processors can filter on it.
		logger?.log("telemetry-demo setup", {
			sessionId: ctx.session?.sessionId,
			hasTelemetry: Boolean(telemetry),
		});

		// Telemetry event: aggregated, low-cardinality. Arrives at the host as
		// `plugin.demo_setup` with plugin_name/session_id stamped on.
		telemetry?.capture({
			event: "demo_setup",
			properties: { has_workspace: Boolean(ctx.workspaceInfo?.rootPath) },
		});

		api.registerTool(
			createTool({
				name: "roll_die",
				description:
					"Roll a six-sided die and return the result. Demonstrates plugin telemetry and logging.",
				inputSchema: {
					type: "object",
					properties: {
						sides: {
							type: "number",
							description: "Number of sides (default 6).",
						},
					},
					required: [],
				},
				execute: async (input: unknown) => {
					const { sides = 6 } = (input ?? {}) as { sides?: number };

					if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
						// Failure pattern: log the details for the user's log file,
						// count the failure class (not the message!) in telemetry,
						// and return a structured error for the model.
						// `error` is optional on BasicLogger — hence `?.` twice.
						logger?.error?.("roll_die rejected invalid input", {
							sides,
						});
						telemetry?.recordCounter("demo.tool_errors", 1, {
							tool_name: "roll_die",
							reason: "invalid_sides",
						});
						return { error: "sides must be an integer between 2 and 1000" };
					}

					const roll = 1 + Math.floor(Math.random() * sides);
					rollCount += 1;
					bestRoll = Math.max(bestRoll, roll);

					// debug-level: noisy per-call detail, invisible unless the
					// host's log level includes debug.
					logger?.debug("roll_die rolled", { roll, sides, rollCount });

					// Metrics: counter for volume, histogram for distributions,
					// gauge for point-in-time values. Attribute values must stay
					// low-cardinality — `sides` is fine, a user string is not.
					telemetry?.recordCounter("demo.rolls", 1, { sides });
					telemetry?.recordHistogram("demo.roll_value", roll, { sides });
					telemetry?.recordGauge("demo.best_roll", bestRoll);

					return { roll, sides };
				},
			}),
		);
	},

	hooks: {
		afterRun({ result }) {
			// End-of-run summary event. `captureRequired` bypasses sampling for
			// events that must not be dropped (billing-grade); plain `capture`
			// is right for almost everything, including this.
			telemetry?.capture({
				event: "demo_run_completed",
				properties: {
					status: result.status,
					iterations: result.iterations,
					rolls: rollCount,
					best_roll: bestRoll,
				},
			});
			logger?.log("telemetry-demo run completed", {
				status: result.status,
				rolls: rollCount,
			});
		},
	},
};

export { plugin };
export default plugin;
