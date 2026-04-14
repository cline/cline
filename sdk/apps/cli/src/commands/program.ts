import { Command, CommanderError } from "commander";
import { version } from "../../package.json";
import type { ParsedArgs } from "../utils/types";

export { CommanderError };

/**
 * Collect repeatable option values into an array.
 */
function collect(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

function expandToolOptionValues(values: string[]): string[] {
	return values.flatMap((value) =>
		value
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean),
	);
}

function normalizeAutoApproveValue(
	value: string | boolean | undefined,
): string {
	if (value === undefined || value === true) {
		return "true";
	}
	return String(value);
}

/**
 * Add the shared root-level options to any command.
 */
export function addRootOptions(cmd: Command): Command {
	return cmd
		.option(
			"--acp",
			"[TODO] Run in ACP (Agent Client Protocol) mode for editor integration",
		)
		.option("-a, --act", "Run in act mode")
		.option(
			"--auto-approve-all",
			"Enable auto-approve all actions while keeping interactive mode",
		)
		.option(
			"--autoapprove [value]",
			"Set tool auto-approval for all tools (`true` or `false`)",
			normalizeAutoApproveValue,
		)
		.option("--config <dir>", "Configuration directory")
		.option("-c, --cwd <path>", "Working directory")
		.option("--enable-spawn") // alias for --spawn
		.option(
			"--hooks-dir <dir>",
			"Path to additional hooks directory for runtime hook injection",
		)
		.option("-i, --interactive", "Start interactive chat mode")
		.option("--json", "Output messages as JSON instead of styled text")
		.option("-k, --key <api-key>", "API key override for this run")
		.option("--apiKey <api-key>") // hidden alias for --key
		.option(
			"--max-consecutive-mistakes <count>",
			"Maximum consecutive mistakes before halting in yolo mode",
		)
		.option("-n, --max-iterations <count>")
		.option(
			"--mission-step-interval <count>",
			"Mission log update cadence in meaningful steps",
		)
		.option(
			"--mission-time-interval-ms <ms>",
			"Mission log update cadence in milliseconds",
		)
		.option("-m, --model <model>", "Model to use for the task")
		.option("-p, --plan", "Run in plan mode")
		.option("-P, --provider <id>", "Provider id (default: cline)")
		.option(
			"--reasoning-effort <level>",
			"Reasoning effort: none|low|medium|high|xhigh",
		)
		.option("--refresh-models", "Refresh provider model catalog for this run")
		.option("--sandbox", "Use isolated local state instead of ~/.cline")
		.option(
			"--sandbox-dir <dir>",
			"Sandbox state dir (default: $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox)",
		)
		.option("--spawn", undefined, true)
		.option("--no-spawn", "Disable spawn_agent")
		.option("-s, --system <prompt>", "Override the system prompt")
		.option("-T, --taskId <id>", "Resume an existing task by ID")
		.option("--team-name <name>", "Override the runtime team state name")
		.option("--teams", undefined, true)
		.option("--no-teams", "Disable agent-team tools")
		.option("--thinking", "Enable extended thinking (default: medium effort)")
		.option(
			"-t, --timeout <seconds>",
			"Optional timeout in seconds (applies only when provided)",
		)
		.option("--timings", "Show timing details")
		.option("--tool-disable <name>", "Explicitly disable one tool", collect, [])
		.option("--tool-enable <name>", "Explicitly enable one tool", collect, [])
		.option("--tools", undefined, true)
		.option("--no-tools", "Disable tools")
		.option("-u, --usage", "Show token usage and estimated cost")
		.option("-v, --verbose", "Show verbose output")
		.option("-y, --yolo", "Enable yolo mode (auto-approve actions)");
}

export function createProgram(): Command {
	const program = new Command("clite")
		.description("Cline CLI - AI coding assistant in your terminal")
		.version(version, "-V, --version", "Output the version number")
		.exitOverride() // don't call process.exit
		.configureOutput({
			writeOut: () => {}, // suppress by default; main.ts re-enables for routing
			writeErr: () => {},
		})
		.allowUnknownOption()
		.allowExcessArguments()
		.enablePositionalOptions()
		.argument("[prompt]", "Task prompt (starts task immediately)");

	addRootOptions(program);

	return program;
}

export function commanderToParsedArgs(program: Command): ParsedArgs {
	const opts = program.opts();
	const spawnValueSource = program.getOptionValueSource("spawn");
	const teamsValueSource = program.getOptionValueSource("teams");

	const result: ParsedArgs = {
		verbose: !!opts.verbose,
		interactive: !!opts.interactive,
		showUsage: !!opts.usage,
		showTimings: !!opts.timings,
		outputMode: opts.json ? "json" : "text",
		mode: opts.plan ? "plan" : "act",
		yolo: opts.yolo ?? false,
		sandbox: !!opts.sandbox,
		acpMode: !!opts.acp,
		thinking: !!opts.thinking,
		reasoningEffort: undefined,
		liveModelCatalog: !!opts.refreshModels,
		enableSpawnAgent: opts.enableSpawn ? true : opts.spawn,
		enableAgentTeams: opts.teams,
		enableTools: opts.tools,
		defaultToolAutoApprove: true,
		toolPolicies: {},
	};

	// --enable-spawn overrides --spawn/--no-spawn
	if (opts.enableSpawn) {
		result.enableSpawnAgent = true;
	}

	if (opts.yolo) {
		if (!opts.enableSpawn && spawnValueSource === "default") {
			result.enableSpawnAgent = false;
		}
		if (teamsValueSource === "default") {
			result.enableAgentTeams = false;
		}
	}

	// Approval: last-wins semantics
	if (opts.autoapprove !== undefined) {
		const raw = String(opts.autoapprove).trim().toLowerCase();
		if (raw === "true") {
			result.defaultToolAutoApprove = true;
		} else if (raw === "false") {
			result.defaultToolAutoApprove = false;
		} else if (raw) {
			result.invalidAutoApprove = raw;
		}
	}
	if (opts.autoApproveAll || opts.yolo) {
		result.defaultToolAutoApprove = true;
	}

	// Timeout validation
	if (opts.timeout !== undefined) {
		const raw = opts.timeout.trim();
		const parsed = Number.parseInt(raw, 10);
		if (raw && Number.isInteger(parsed) && parsed >= 1) {
			result.timeoutSeconds = parsed;
		} else if (raw) {
			result.invalidTimeoutSeconds = raw;
		}
	}

	if (opts.reasoningEffort !== undefined) {
		const effort = opts.reasoningEffort.trim().toLowerCase();
		if (
			effort === "none" ||
			effort === "low" ||
			effort === "medium" ||
			effort === "high" ||
			effort === "xhigh"
		) {
			result.reasoningEffort = effort;
		} else if (effort) {
			result.invalidReasoningEffort = effort;
		}
	}

	// Max consecutive mistakes validation
	if (opts.maxConsecutiveMistakes !== undefined) {
		const raw = opts.maxConsecutiveMistakes.trim();
		const parsed = Number.parseInt(raw, 10);
		if (raw && Number.isInteger(parsed) && parsed >= 1) {
			result.maxConsecutiveMistakes = parsed;
		} else if (raw) {
			result.invalidMaxConsecutiveMistakes = raw;
		}
	}

	// Simple string/number options
	if (opts.sandboxDir !== undefined) result.sandboxDir = opts.sandboxDir;
	if (opts.config !== undefined) result.configDir = opts.config;
	if (opts.hooksDir !== undefined) result.hooksDir = opts.hooksDir;
	if (opts.cwd !== undefined) result.cwd = opts.cwd;
	if (opts.teamName !== undefined) result.teamName = opts.teamName;
	if (opts.system !== undefined) result.systemPrompt = opts.system;
	if (opts.model !== undefined) result.model = opts.model;
	if (opts.provider !== undefined) result.provider = opts.provider;
	if (opts.key !== undefined) result.key = opts.key;
	else if (opts.apiKey !== undefined) result.key = opts.apiKey;
	if (opts.taskId !== undefined) result.taskId = opts.taskId;

	if (opts.maxIterations !== undefined) {
		result.maxIterations = Number.parseInt(opts.maxIterations, 10);
	}
	if (opts.missionStepInterval !== undefined) {
		result.missionLogIntervalSteps = Number.parseInt(
			opts.missionStepInterval,
			10,
		);
	}
	if (opts.missionTimeIntervalMs !== undefined) {
		result.missionLogIntervalMs = Number.parseInt(
			opts.missionTimeIntervalMs,
			10,
		);
	}

	// Tool policies
	const toolEnable = expandToolOptionValues(opts.toolEnable ?? []);
	const toolDisable = expandToolOptionValues(opts.toolDisable ?? []);

	for (const name of toolEnable) {
		result.toolPolicies[name] = {
			...(result.toolPolicies[name] ?? {}),
			enabled: true,
		};
	}
	for (const name of toolDisable) {
		result.toolPolicies[name] = {
			...(result.toolPolicies[name] ?? {}),
			enabled: false,
		};
	}

	// Positional args → prompt
	const positional = program.args.filter((a) => !a.startsWith("-"));
	if (positional.length > 0) {
		result.prompt = positional.join(" ");
	}

	return result;
}
