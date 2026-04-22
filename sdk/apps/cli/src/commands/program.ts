import { Command, CommanderError } from "commander";
import { version } from "../../package.json";
import type { ParsedArgs } from "../utils/types";

export { CommanderError };

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
			"Run in ACP (Agent Client Protocol) mode for editor integration",
		)
		.option("-a, --act", "Run in act mode")
		.option(
			"--autoapprove [value]",
			"Set tool auto-approval for all tools (`true` or `false`)",
			normalizeAutoApproveValue,
		)
		.option("--config <dir>", "Configuration directory")
		.option("-c, --cwd <path>", "Working directory")
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
		.option("-s, --system <prompt>", "Override the system prompt")
		.option("-T, --taskId <id>", "Resume an existing task by ID")
		.option("--team-name <name>", "Override the runtime team state name")
		.option("--thinking", "Enable extended thinking (default: medium effort)")
		.option(
			"-t, --timeout <seconds>",
			"Optional timeout in seconds (applies only when provided)",
		)
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

	const result: ParsedArgs = {
		verbose: !!opts.verbose,
		interactive: !!opts.interactive,
		showUsage: !!opts.usage,
		outputMode: opts.json ? "json" : "text",
		mode: opts.plan ? "plan" : "act",
		yolo: opts.yolo ?? false,
		sandbox: !!opts.sandbox,
		acpMode: !!opts.acp,
		thinking: !!opts.thinking,
		reasoningEffort: undefined,
		liveModelCatalog: !!opts.refreshModels,
		defaultToolAutoApprove: true,
	};

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
	if (opts.yolo) {
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

	// Positional args → prompt
	const positional = program.args.filter((a) => !a.startsWith("-"));
	if (positional.length > 0) {
		result.prompt = positional.join(" ");
	}

	return result;
}
