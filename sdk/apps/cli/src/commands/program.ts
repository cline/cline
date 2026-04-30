import { Command, CommanderError, Option } from "commander";
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
		.option("-a, --act", "Run in act mode")
		.option("-p, --plan", "Run in plan mode")
		.addOption(
			// `-y, --yolo` is still accepted (and behaves the same as before) but
			// hidden from `--help` output.
			new Option(
				"-y, --yolo",
				"Enable yolo mode where agents can use tools without approval with only a small set of tools available.",
			).hideHelp(),
		)
		.option(
			"--autoapprove [value]",
			"Set tool auto-approval for all tools (`true` or `false`)",
			normalizeAutoApproveValue,
		)
		.option(
			"-t, --timeout <seconds>",
			"Optional timeout in seconds (applies only when provided)",
		)
		.option("-m, --model <model>", "Model to use for the task")
		.option("-v, --verbose", "Show verbose output")
		.option("-c, --cwd <path>", "Working directory")
		.option("--config <dir>", "Configuration directory")
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("--thinking", "Enable extended thinking (default: medium effort)")
		.option(
			"--reasoning-effort <level>",
			"Reasoning effort: none|low|medium|high|xhigh",
		)
		.option(
			"--retries <count>",
			"Maximum consecutive mistakes (retries) before halting",
		)
		.option("--json", "Output messages as JSON instead of styled text")
		.option(
			"--hooks-dir <dir>",
			"Path to additional hooks directory for runtime hook injection",
		)
		.option(
			"--acp",
			"Run in ACP (Agent Client Protocol) mode for editor integration",
		)
		.option("--update", "Check for updates and install if available")
		.option("-i, --tui", "Start interactive TUI chat mode")
		.option("--id <id>", "Resume an existing task by ID")
		.option("-k, --key <api-key>", "API key override for this run")
		.option("-P, --provider <id>", "Provider id (default: cline)")
		.option("-s, --system <prompt>", "Override the system prompt")
		.option("--team-name <name>", "Override the runtime team state name")
		.option(
			"-z, --zen",
			"Run the task in the background hub and exit immediately (menubar app notifies on completion)",
		);
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
		interactive: !!opts.tui,
		outputMode: opts.json ? "json" : "text",
		mode: opts.plan ? "plan" : opts.yolo ? "yolo" : opts.zen ? "zen" : "act",
		sandbox: !!opts.dataDir,
		acpMode: !!opts.acp,
		thinking: !!opts.thinking,
		reasoningEffort: undefined,
		defaultToolAutoApprove: true,
		id: opts.id,
	};

	// Approval: last-wins semantics
	if (opts.autoapprove !== undefined) {
		const raw = String(opts.autoapprove).trim().toLowerCase();
		if (raw === "true") {
			result.defaultToolAutoApprove = true;
			result.autoApproveOverride = true;
		} else if (raw === "false") {
			result.defaultToolAutoApprove = false;
			result.autoApproveOverride = false;
		} else if (raw) {
			result.invalidAutoApprove = raw;
		}
	}
	if (opts.yolo) {
		result.defaultToolAutoApprove = true;
		result.autoApproveOverride = true;
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

	// Retries (max consecutive mistakes) validation
	if (opts.retries !== undefined) {
		const raw = opts.retries.trim();
		const parsed = Number.parseInt(raw, 10);
		if (raw && Number.isInteger(parsed) && parsed >= 1) {
			result.retries = parsed;
		} else if (raw) {
			result.invalidRetries = raw;
		}
	}

	// Simple string/number options
	if (opts.dataDir !== undefined) result.dataDir = opts.dataDir;
	if (opts.config !== undefined) result.configDir = opts.config;
	if (opts.hooksDir !== undefined) result.hooksDir = opts.hooksDir;
	if (opts.cwd !== undefined) result.cwd = opts.cwd;
	if (opts.teamName !== undefined) result.teamName = opts.teamName;
	if (opts.system !== undefined) result.systemPrompt = opts.system;
	if (opts.model !== undefined) result.model = opts.model;
	if (opts.provider !== undefined) result.provider = opts.provider;
	if (opts.key !== undefined) result.key = opts.key;
	else if (opts.apiKey !== undefined) result.key = opts.apiKey;
	if (opts.id !== undefined) result.id = opts.id;

	// Positional args → prompt
	const positional = program.args.filter((a) => !a.startsWith("-"));
	if (positional.length > 0) {
		result.prompt = positional.join(" ");
	}

	return result;
}
