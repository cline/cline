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
	return (
		cmd
			.option("-p, --plan", "Run in plan mode")
			.option("--json", "Output messages as JSON instead of styled text")
			.option(
				"--auto-approve <boolean>",
				"Set tool auto-approval for all tools (default: true)",
				normalizeAutoApproveValue,
			)
			.option("-c, --cwd <path>", "Working directory")
			.option(
				"--thinking <level>",
				"Set reasoning effort level between none|low|medium|high|xhigh (default: medium)",
			)
			.option(
				"-i, --tui",
				"Open the terminal user interface (TUI) for interactive sessions",
			)
			.option("--id <session-id>", "Resume an existing session by ID")
			.option("-P, --provider <id>", "Provider id (default: cline)")
			.option("-k, --key <api-key>", "API key override for this run")
			.option(
				"-m, --model <model-id>",
				"Model to use for the session with the selected provider",
			)
			.option(
				"-s, --system <system-prompt>",
				"Override the default system prompt",
			)
			.option("-z, --zen", "Start a session that runs in the background hub")
			.option(
				"--retries [value]",
				"Number of maximum consecutive mistakes (retries) before exiting (default: 6)",
			)
			.option(
				"-t, --timeout <seconds>",
				"Optional timeout in seconds (default: 0 for no timeout)",
			)
			.option(
				"--acp",
				"Run in Agent Client Protocol (ACP) mode for editor integration",
			)
			.option(
				"--config <path>",
				"Configuration directory (default: ~/.cline/data/settings)",
			)
			.option(
				"--data-dir <path>",
				"Use isolated local state at this directory path (default: ~/.cline)",
			)
			.option(
				"--hooks-dir <path>",
				"Directory path to additional hooks for runtime hook injection (default: ~/.cline/hooks)",
			)
			.option("--update", "Check for updates and install if available")
			.option("-v, --verbose", "Show verbose output")
			// HIDDEN/LEGACY OPTIONS BELOW
			.addOption(
				// Act mode is the default. Keep the legacy flags accepted for users who
				// still pass them, but do not advertise them in help output.
				new Option("-a, --act", "Run in act mode").hideHelp(),
			)
			.addOption(
				// `-y, --yolo` is still accepted (and behaves the same as before) but
				// hidden from `--help` output.
				new Option(
					"-y, --yolo",
					"Enable yolo mode where agents can use tools without approval with only a small set of tools available.",
				).hideHelp(),
			)
			.addOption(
				// TODO: Refactor teams to resume session without team name
				new Option(
					"--team-name <name>",
					"Override the runtime team state name",
				).hideHelp(),
			)
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
		.argument(
			"[prompt]",
			"Your prompt. Default to start in act mode with auto-approve enabled.",
		);

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
		thinking: false,
		reasoningEffort: undefined,
		defaultToolAutoApprove: true,
		id: opts.id,
	};

	// Approval: last-wins semantics
	if (opts.autoApprove !== undefined) {
		const raw = String(opts.autoApprove).trim().toLowerCase();
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

	if (opts.thinking !== undefined) {
		const effort = String(opts.thinking).trim().toLowerCase();
		if (
			effort === "none" ||
			effort === "low" ||
			effort === "medium" ||
			effort === "high" ||
			effort === "xhigh"
		) {
			if (effort === "none") {
				result.thinking = false;
				result.reasoningEffort = undefined;
			} else {
				result.thinking = true;
				result.reasoningEffort = effort;
			}
		} else if (effort) {
			result.invalidThinkingLevel = effort;
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
