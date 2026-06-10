import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { readGlobalSettings, type ToolPolicy } from "@cline/core";

import { registerDisposable } from "@cline/shared";
import type { Command } from "commander";
import {
	CommanderError,
	commanderToParsedArgs,
	createProgram,
} from "./commands/program";
import {
	autoUpdateOnStartup,
	getPreferredKanbanInstaller,
} from "./commands/update";
import { CLI_DEFAULT_CHECKPOINT_CONFIG } from "./runtime/defaults";
import {
	buildCliCompactionConfig,
	CLI_COMPACTION_MODE_EXPECTED_TEXT,
} from "./utils/compaction-mode";
import {
	getCliFeatureFlagsService,
	refreshCliFeatureFlagsInBackground,
	setCliFeatureFlagsAccountContext,
} from "./utils/feature-flags";
import {
	configureSandboxEnvironment,
	normalizeAutoApproveArgs,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import {
	c,
	installStreamErrorGuards,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./utils/output";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "./utils/provider-auth";
import { resolveCliReasoning } from "./utils/reasoning";
import { rewriteTeamPrompt, TEAM_COMMAND_USAGE } from "./utils/team-command";
import {
	captureCliExtensionActivated,
	getCliTelemetryService,
} from "./utils/telemetry";
import type { Config } from "./utils/types";
import { runConnectWizard } from "./wizards/connect";
import { runMcpWizard } from "./wizards/mcp";
import { runScheduleWizard } from "./wizards/schedule";

export function stdinHasPipedInput(): boolean {
	if (process.stdin.isTTY) return false;
	try {
		const stats = fstatSync(0);
		return stats.isFIFO() || stats.isFile();
	} catch {
		return false;
	}
}

async function createProviderSettingsManager() {
	const { ProviderSettingsManager } = await import("@cline/core");
	return new ProviderSettingsManager();
}

async function loadCliRuntimeModules() {
	const [coreServer, prompt, runAgentModule] = await Promise.all([
		import("@cline/core"),
		import("./runtime/prompt"),
		import("./runtime/run-agent"),
	]);
	return {
		coreServer,
		resolveSystemPrompt: prompt.resolveSystemPrompt,
		runAgent: runAgentModule.runAgent,
	};
}

async function loadInteractiveRuntimeModule() {
	const { runInteractive } = await import("./runtime/run-interactive");
	return runInteractive;
}

/**
 * Two-pass approach for --config: a quick scan of process.argv extracts the
 * config directory before commander parses, because setClineDir() must run
 * before any code that reads the home/config directory.
 *
 * Recognizes both Commander spellings:
 *   --config <dir>
 *   --config=<dir>
 *
 * Exported for unit testing; callers in this file should use this rather
 * than reimplementing the scan.
 */
export function resolveConfigDirArg(argv: string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--config") {
			const value = argv[i + 1]?.trim();
			return value ? value : undefined;
		}
		if (arg?.startsWith("--config=")) {
			const value = arg.slice("--config=".length).trim();
			return value ? value : undefined;
		}
	}
	return undefined;
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

// Shells strip quote characters before argv reaches us, so a prompt that was
// typed in quotes is only observable when it remains one argv token with spaces.
function promptArgLooksQuoted(arg: string | undefined): boolean {
	return !!arg && /\s/.test(arg);
}

function writePromptArgError(args: string[]): void {
	const renderedArgs = args.join(" ");
	writeErr(
		`Unknown command or unquoted prompt: ${renderedArgs}\nPrompt text must be passed as a single quoted argument, for example: cline "fix the tests". Use "cline --help" to see available commands and flags.`,
	);
}

export async function runCli(): Promise<void> {
	installStreamErrorGuards();
	autoUpdateOnStartup();

	const cliArgs = process.argv.slice(2);
	const configDir = resolveConfigDirArg(cliArgs);
	const { setClineDir, setHomeDir } = await import("@cline/shared/storage");
	if (configDir) {
		setClineDir(configDir);
	}
	setHomeDir(homedir());

	// Capture activation telemetry only after config/home directory selection
	// has been applied, so the telemetry singleton's persisted distinct-id
	// (and any other storage it touches) lands under the user-selected
	// `--config <dir>` rather than the default home/config location.
	captureCliExtensionActivated();

	let launchConfigView = false;
	const normalizedArgs = normalizeAutoApproveArgs(cliArgs);

	// Subcommand routing via Commander
	const ctx: { exitCode?: number; resumeSessionId?: string } = {};
	const io = { writeln, writeErr };
	const program = createProgram();
	// Re-enable built-in help/version output for the routing program
	program.configureOutput({
		writeOut: (str: string) => process.stdout.write(str),
		writeErr: () => {},
	});
	// Default action handles non-subcommand args (e.g. prompt text)
	program.action(() => {});

	// Auth subcommand: defines its own options so commander parses them
	// directly. The short flags -p/-m intentionally shadow the root's -p (plan)
	// and -m (model); commander scopes options per-command so there is no
	// conflict.
	const authCmd = program
		.command("auth")
		.description("Authenticate a provider and configure what model is used")
		.argument("[provider]", "Provider id (positional shorthand for -p)")
		.option("-p, --provider <id>", "Provider ID")
		.option("-k, --apikey <key>", "API key")
		.option("-m, --modelid <id>", "Model ID")
		.option("-b, --baseurl <url>", "Base URL")
		.option("--azure-api-version <version>", "Azure API version")
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Working directory")
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("-v, --verbose", "Show verbose output")
		.action(async (positionalProvider: string | undefined) => {
			const opts = authCmd.opts<{
				provider?: string;
				apikey?: string;
				modelid?: string;
				baseurl?: string;
				azureApiVersion?: string;
				config?: string;
				cwd?: string;
				dataDir?: string;
				verbose?: boolean;
			}>();
			// Honor --config inside the action as a defense-in-depth measure.
			// The early pre-pass in runCli() also calls setClineDir(), but only
			// for argv tokens it can spot before commander runs. Reapplying
			// here ensures opts.config (parsed by commander, including the
			// --config=<dir> form) is always respected before any provider
			// settings manager is constructed against ~/.cline.
			if (opts.config?.trim()) {
				const { setClineDir } = await import("@cline/shared/storage");
				setClineDir(opts.config.trim());
			}
			// Honor --data-dir before constructing the provider settings manager
			// so writes land under the chosen data dir instead of ~/.cline.
			configureSandboxEnvironment({
				enabled: !!opts.dataDir || process.env.CLINE_SANDBOX?.trim() === "1",
				cwd: opts.cwd ?? process.cwd(),
				explicitDir: opts.dataDir,
			});
			const { runAuthCommand } = await import("./commands/auth");
			const providerSettingsManager = await createProviderSettingsManager();
			ctx.exitCode = await runAuthCommand({
				providerSettingsManager,
				explicitProvider: opts.provider ?? positionalProvider,
				apikey: opts.apikey,
				modelid: opts.modelid,
				baseurl: opts.baseurl,
				azureApiVersion: opts.azureApiVersion,
				io,
			});
		});

	const createConfigRuntimeCommand = async () => {
		const { createConfigCommand } = await import("./commands/config");
		let configCmd: Command;
		configCmd = createConfigCommand(
			() => resolveWorkspaceRoot(program.opts().cwd ?? process.cwd()),
			() => {
				const outputMode =
					program.opts().json || configCmd.opts().json
						? ("json" as const)
						: ("text" as const);
				setCurrentOutputMode(outputMode);
				return outputMode;
			},
			io,
			(code) => {
				ctx.exitCode = code;
			},
			() => {
				launchConfigView = true;
			},
		);
		return configCmd;
	};

	program
		.command("config")
		.description("Show current configuration")
		.option("--json", "Output as JSON")
		.option("--config <dir>", "configuration directory")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const realCmd = await createConfigRuntimeCommand();
			await realCmd.parseAsync(cmd.args, { from: "user" });
		});

	const pluginCmd = program
		.command("plugin")
		.description("Manage Cline Plugins")
		.action(() => {
			pluginCmd.help();
		});
	const pluginInstallCmd = pluginCmd
		.command("install")
		.alias("i")
		.description(
			"Install a Cline Plugin from an official keyword, npm, git, URL, or a local path",
		)
		.argument(
			"<source>",
			"official keyword, npm package, git URL, plugin file URL, or local plugin path",
		)
		.option("--npm", "Treat source as an npm package")
		.option("--git", "Treat source as a git repository")
		.option("--force", "Replace an existing install for the same source")
		.option("--json", "Output as JSON")
		.option("--cwd <path>", "Install to <path>/.cline/plugins")
		.action(async (source: string) => {
			const opts = pluginInstallCmd.opts<{
				npm?: boolean;
				git?: boolean;
				force?: boolean;
				json?: boolean;
				cwd?: string;
			}>();
			const sourceTypes = [
				opts.npm ? ("npm" as const) : undefined,
				opts.git ? ("git" as const) : undefined,
			].filter((sourceType) => sourceType !== undefined);
			if (sourceTypes.length > 1) {
				writeErr("plugin install accepts only one source type flag");
				ctx.exitCode = 1;
				return;
			}
			const { runPluginInstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginInstallCommand({
				source,
				sourceType: sourceTypes[0],
				cwd: opts.cwd,
				force: opts.force === true,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const pluginUninstallCmd = pluginCmd
		.command("uninstall")
		.alias("remove")
		.alias("rm")
		.description("Uninstall a Cline Plugin by name or path")
		.argument("<name>", "plugin package name, installed slug, or plugin path")
		.option("--json", "Output as JSON")
		.option(
			"--cwd <path>",
			"Search <path>/.cline/plugins before global plugins",
		)
		.action(async (name: string) => {
			const opts = pluginUninstallCmd.opts<{
				json?: boolean;
				cwd?: string;
			}>();
			const { runPluginUninstallCommand } = await import("./commands/plugin");
			ctx.exitCode = await runPluginUninstallCommand({
				name,
				cwd: opts.cwd,
				json: opts.json === true || program.opts().json === true,
				io,
			});
		});
	const skillCmd = program
		.command("skill")
		.description("Manage Cline Skills via the open skills CLI (npx skills)")
		.allowUnknownOption()
		.passThroughOptions()
		.argument("[args...]", "arguments forwarded to the skills CLI")
		.addHelpText(
			"after",
			"\nForwards to the open skills CLI via npx. Examples:\n" +
				"  cline skill add <owner/repo>       Add a skill into Cline\n" +
				"  cline skill install <owner/repo>   Alias for add\n" +
				"  cline skill list                   List installed skills\n" +
				"  cline skill remove                 Remove installed skills\n" +
				"  cline skill uninstall              Alias for remove\n" +
				"\nadd/install and remove/uninstall default to '--agent cline' unless you pass your own --agent.\n" +
				"Run 'npx skills --help' for the full command reference.",
		)
		.action(async () => {
			const { runSkillCommand } = await import("./commands/skill");
			ctx.exitCode = await runSkillCommand(skillCmd.args, io);
		});

	const connectCmd = program
		.command("connect")
		.description("Connect to an external channel")
		.argument("[channel]", "Channel to connect Cline CLI to")
		.option("--stop", "Kill all current channel connections")
		.allowUnknownOption()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\nRun 'connect <channel> --help' for channel-specific options.",
		)
		.action(async (adapter: string | undefined) => {
			const {
				formatAdapterList,
				runConnectAdapter,
				runStopAllConnectors,
				runStopConnector,
			} = await import("./commands/connect");
			const opts = connectCmd.opts();
			if (opts.stop) {
				if (adapter) {
					ctx.exitCode = await runStopConnector(adapter, io);
				} else {
					ctx.exitCode = await runStopAllConnectors(io);
				}
			} else if (adapter) {
				// connectCmd.args = [adapter, ...passthroughFlags]. Pass only the
				// connector-specific flags (everything after the adapter name).
				ctx.exitCode = await runConnectAdapter(
					adapter,
					connectCmd.args.slice(1),
					io,
				);
			} else if (process.stdin.isTTY && process.stdout.isTTY) {
				ctx.exitCode = await runConnectWizard();
			} else {
				writeln(`\nAdapters:\n${formatAdapterList()}`);
				connectCmd.help();
			}
		});

	const mcpCmd = program
		.command("mcp")
		.description("Manage MCP servers")
		.action(async () => {
			if (process.stdin.isTTY && process.stdout.isTTY) {
				ctx.exitCode = await runMcpWizard();
			} else {
				writeln(
					"MCP wizard requires a TTY. Use cline config mcp to list servers.",
				);
			}
		});
	const mcpInstallCmd = mcpCmd
		.command("install")
		.alias("add")
		.description("Open the MCP add wizard with server fields prefilled")
		.argument("<name>", "MCP server name")
		.argument(
			"[targetArgs...]",
			"URL for remote transports, or command and args after -- for stdio",
		)
		.option(
			"--transport <transport>",
			"stdio, sse, http, streamable-http, or streamableHttp (default: stdio)",
		)
		.option("--header <header>", "Remote MCP request header", collectOption, [])
		.option("--yes", "Install noninteractively without opening the wizard")
		.option("--json", "Output as JSON")
		.action(async (name: string, targetArgs: string[]) => {
			const opts = mcpInstallCmd.opts<{
				header?: string[];
				json?: boolean;
				transport?: string;
				yes?: boolean;
			}>();
			const { runMcpInstallCommand } = await import("./commands/mcp");
			ctx.exitCode = await runMcpInstallCommand({
				name,
				headers: opts.header,
				targetArgs,
				transport: opts.transport,
				json: opts.json === true || program.opts().json === true,
				yes: opts.yes === true,
				io,
			});
		});

	const createDoctorRuntimeCommand = async () => {
		const { createDoctorCommand } = await import("./commands/doctor");
		return createDoctorCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("doctor")
		.description("Diagnose and fix configuration issues")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\nCommands:\n  fix  Kill all running processes\n  log  Open the CLI log file\n",
		)
		.action(async (_opts: unknown, cmd: Command) => {
			const doctorCmd = await createDoctorRuntimeCommand();
			await doctorCmd.parseAsync(cmd.args, { from: "user" });
		});

	const historyCmd = program
		.command("history")
		.alias("h")
		.description("List session history or manage saved sessions")
		.option("--json", "Output as JSON")
		.option("--limit <count>", "Maximum number of sessions to show", "50")
		.option("--page <number>", "Page number for paginated results")
		.option("--config <dir>", "configuration directory")
		.action(async () => {
			const opts = historyCmd.opts();
			const limit = Number.parseInt(opts.limit, 10);
			const outputMode =
				program.opts().json || opts.json
					? ("json" as const)
					: ("text" as const);
			const { runHistoryList } = await import("./commands/history");
			const result = await runHistoryList({
				limit,
				outputMode,
				io,
			});
			if (typeof result === "string") {
				ctx.resumeSessionId = result;
				// JSON listing should never return a session id; if it does, still exit here so
				// we never fall through to agent bootstrap (which can block on stdin in CI).
				if (outputMode === "json") {
					ctx.exitCode = 0;
				}
			} else {
				// Always set exit code for numeric results so `ctx.exitCode` is never left
				// undefined (that would fall through and load the full CLI runtime).
				ctx.exitCode = result ?? 0;
			}
		});

	const historyDeleteCmd = historyCmd
		.command("delete")
		.description("Delete a session from history")
		.option("--session-id <id>", "Session ID to delete")
		.action(async () => {
			const opts = historyDeleteCmd.opts();
			if (!opts.sessionId) {
				writeErr("history delete requires --session-id <id>");
				ctx.exitCode = 0;
				return;
			}
			const outputMode =
				program.opts().json || historyCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runHistoryDelete } = await import("./commands/history");
			ctx.exitCode = await runHistoryDelete(opts.sessionId, outputMode, io);
		});

	const historyUpdateCmd = historyCmd
		.command("update")
		.description("Update a session in history")
		.option("--metadata <json>", "Metadata as JSON string")
		.option("--prompt <text>", "New prompt text")
		.option("--session-id <id>", "Session ID to update")
		.option("--title <text>", "New title")
		.action(async () => {
			const opts = historyUpdateCmd.opts();
			if (!opts.sessionId) {
				writeErr("history update requires --session-id <id>");
				ctx.exitCode = 1;
				return;
			}
			const outputMode =
				program.opts().json || historyCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runHistoryUpdate } = await import("./commands/history");
			ctx.exitCode = await runHistoryUpdate(
				opts.sessionId,
				opts.prompt,
				opts.title,
				opts.metadata,
				outputMode,
				io,
			);
		});

	const historyExportCmd = historyCmd
		.command("export <sessionId>")
		.description("Export a session as a standalone HTML file")
		.option("-o, --output <path>", "Output HTML file path")
		.action(async (sessionId: string) => {
			const opts = historyExportCmd.opts();
			const outputMode =
				program.opts().json || historyCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runHistoryExport } = await import("./commands/history");
			ctx.exitCode = await runHistoryExport(
				sessionId,
				opts.output,
				outputMode,
				io,
			);
		});

	program
		.command("hook")
		.description("Handle a hook payload from stdin")
		.allowUnknownOption()
		.allowExcessArguments()
		.action(async () => {
			const { runHookCommand } = await import("./commands/hook");
			ctx.exitCode = await runHookCommand(io);
		});

	const createScheduleRuntimeCommand = async () => {
		const { createScheduleCommand } = await import("./commands/schedule");
		return createScheduleCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};
	const createHubRuntimeCommand = async () => {
		const { createHubCommand } = await import("./commands/hub");
		return createHubCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("schedule")
		.description("Manage scheduled tasks")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			if (
				cmd.args.length === 0 &&
				process.stdin.isTTY &&
				process.stdout.isTTY
			) {
				ctx.exitCode = await runScheduleWizard();
				return;
			}
			const scheduleCmd = await createScheduleRuntimeCommand();
			await scheduleCmd.parseAsync(cmd.args, { from: "user" });
		});
	program
		.command("hub")
		.description("Manage the local hub daemon")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.action(async (_opts: unknown, cmd: Command) => {
			const hubCmd = await createHubRuntimeCommand();
			await hubCmd.parseAsync(cmd.args, { from: "user" });
		});

	const dashboardCmd = program
		.command("dashboard")
		.description("Start the Cline Hub dashboard and open it in a browser")
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Workspace root", process.cwd())
		.option(
			"--data-dir <dir>",
			"Use isolated local state at <dir> instead of ~/.cline (enables sandbox mode)",
		)
		.option("--host <host>", "Dashboard bind host")
		.option("--port <port>", "Dashboard HTTP/WebSocket port")
		.option("--public-url <url>", "Public dashboard URL")
		.option("--room-secret <secret>", "Invite secret for browser access")
		.option("--no-open", "Start the dashboard without opening a browser")
		.action(async () => {
			const opts = dashboardCmd.opts<{
				config?: string;
				cwd?: string;
				dataDir?: string;
				host?: string;
				port?: string;
				publicUrl?: string;
				roomSecret?: string;
				open?: boolean;
			}>();
			const { runDashboardCommand } = await import("./commands/dashboard");
			ctx.exitCode = await runDashboardCommand({
				configDir: opts.config,
				cwd: opts.cwd,
				dataDir: opts.dataDir,
				host: opts.host,
				port: opts.port,
				publicUrl: opts.publicUrl,
				roomSecret: opts.roomSecret,
				openBrowser: opts.open !== false,
				io,
			});
		});

	const updateCmd = program
		.command("update")
		.description("Check for updates and install if available")
		.allowUnknownOption()
		.allowExcessArguments()
		.option("-v, --verbose", "Show verbose output")
		.option("--config <dir>", "configuration directory")
		.action(async () => {
			const { checkForUpdates } = await import("./commands/update");
			ctx.exitCode = await checkForUpdates({
				verbose: updateCmd.opts().verbose === true,
			});
		});

	program
		.command("version")
		.description("Show Cline CLI version number")
		.action(async () => {
			const { showVersion } = await import("./commands/help");
			showVersion();
			ctx.exitCode = 0;
		});

	program
		.command("kanban")
		.description("Run the kanban app")
		.action(async () => {
			const { launchKanban } = await import("./commands/kanban");
			ctx.exitCode = await launchKanban({
				preferredInstaller: getPreferredKanbanInstaller(),
			});
		});

	try {
		await program.parseAsync(normalizedArgs, { from: "user" });
	} catch (err: unknown) {
		if (err instanceof CommanderError) {
			if (err.exitCode !== 0) {
				writeErr(err.message);
				process.exitCode = err.exitCode;
				return;
			}
			return;
		}
		throw err;
	}

	if (ctx.exitCode !== undefined) {
		process.exitCode = ctx.exitCode;
		return;
	}

	const rootOpts = program.opts<{
		kanban?: boolean;
		tui?: boolean;
		update?: boolean;
		verbose?: boolean;
	}>();
	if (rootOpts.update) {
		if (rootOpts.kanban || rootOpts.tui || program.args.length > 0) {
			writeErr("Use --update without a prompt or task flags.");
			process.exitCode = 1;
			return;
		}
		const { checkForUpdates } = await import("./commands/update");
		process.exitCode = await checkForUpdates({
			verbose: rootOpts.verbose === true,
		});
		return;
	}
	if (rootOpts.kanban) {
		if (rootOpts.tui) {
			writeErr("Use either --kanban or --tui, not both.");
			process.exitCode = 1;
			return;
		}
		if (program.args.length > 0) {
			writeErr("Use --kanban without a prompt.");
			process.exitCode = 1;
			return;
		}
		const { launchKanban } = await import("./commands/kanban");
		process.exitCode = await launchKanban({
			preferredInstaller: getPreferredKanbanInstaller(),
		});
		return;
	}

	// Default flow: no subcommand matched, or fall-through from config/history.
	let args = commanderToParsedArgs(program);

	let resumeSessionId: string | undefined = ctx.resumeSessionId;
	if (resumeSessionId) {
		// The history picker already created (and tore down) an OpenTUI renderer
		// in this process; starting the interactive TUI here would create a
		// second one, which can crash natively during teardown. Resume in a
		// fresh `cline --id <session-id>` child process instead.
		const { spawnHistoryResume } = await import("./utils/history-resume");
		const childExitCode = await spawnHistoryResume({
			sessionId: resumeSessionId,
			normalizedArgs,
			remainingArgs: program.args,
			configDir,
		});
		if (childExitCode !== undefined) {
			process.exitCode = childExitCode;
			return;
		}
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	}

	if (args.id !== undefined) {
		const sessionId = args.id.trim();
		if (!sessionId) {
			writeErr("--id requires <session-id>");
			process.exitCode = 1;
			return;
		}
		resumeSessionId = sessionId;
		process.env.CLINE_HOOK_AGENT_RESUME = "1";
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	} else {
		delete process.env.CLINE_HOOK_AGENT_RESUME;
	}
	if (launchConfigView) {
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	}

	if (args.invalidThinkingLevel) {
		writeErr(
			`invalid thinking level "${args.invalidThinkingLevel}" (expected "none", "low", "medium", "high", or "xhigh")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidCompactionMode) {
		writeErr(
			`invalid compaction mode "${args.invalidCompactionMode}" (expected ${CLI_COMPACTION_MODE_EXPECTED_TEXT})`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAutoApprove) {
		writeErr(
			`invalid auto-approve value "${args.invalidAutoApprove}" (expected "true" or "false")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidTimeoutSeconds) {
		writeErr(
			`invalid timeout "${args.invalidTimeoutSeconds}" (expected integer >= 1)`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidRetries) {
		writeln(
			`${c.dim}[warn] ignoring invalid --retries value "${args.invalidRetries}" (expected integer >= 1)${c.reset}`,
		);
	}
	if (args.hooksDir?.trim()) {
		process.env.CLINE_HOOKS_DIR = args.hooksDir.trim();
	}
	if (args.prompt && !args.interactive) {
		if (program.args.length > 1 || !promptArgLooksQuoted(program.args[0])) {
			writePromptArgError(program.args);
			process.exitCode = 1;
			return;
		}
	}
	setCurrentOutputMode(args.outputMode);
	const defaultToolAutoApprove = true;
	const effectiveToolAutoApprove =
		args.autoApproveOverride ?? defaultToolAutoApprove;
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: effectiveToolAutoApprove,
		},
	};

	if (args.outputMode === "json" && (args.interactive || !args.prompt)) {
		writeErr(
			"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
		);
		process.exitCode = 1;
		return;
	}

	// ACP mode: mutually exclusive with interactive/piped modes.
	// Enters the Agent Client Protocol stdio transport and never falls through.
	if (args.acpMode) {
		const { runAcpMode } = await import("./acp/index");
		await runAcpMode();
		return;
	}

	if (args.worktree) {
		if (
			!args.prompt &&
			!resumeSessionId &&
			!stdinHasPipedInput() &&
			(!process.stdin.isTTY || !process.stdout.isTTY)
		) {
			writeErr("--worktree without a prompt requires an interactive terminal.");
			process.exitCode = 1;
			return;
		}
		if (resumeSessionId) {
			const { getSessionRow } = await import("./session/session");
			const session = await getSessionRow(resumeSessionId);
			if (!session) {
				writeErr(`Session not found: ${resumeSessionId}`);
				process.exitCode = 1;
				return;
			}
		}
		const { createTaskWorktree } = await import("./utils/worktree");
		const sourceCwd = args.cwd ?? process.cwd();
		const result = await createTaskWorktree({ cwd: sourceCwd });
		if (!result.success || !result.path) {
			writeErr(`--worktree failed: ${result.message}`);
			process.exitCode = 1;
			return;
		}
		writeln(`Created worktree at ${result.path}`);
		args = {
			...args,
			cwd: result.path,
		};
	}

	const cwd = args.cwd ?? process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	// Sandbox mode is enabled implicitly whenever --data-dir is provided, or
	// when CLINE_SANDBOX=1 is set in the environment (in which case the data
	// dir falls back to $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox).
	const sandboxEnabled =
		!!args.dataDir || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.dataDir,
	});

	// Keep command-style subcommands on a narrow path. Runtime-only imports pull
	// in provider resolution, config services, and session startup wiring that
	// should only load when the CLI is actually starting an agent session.
	const providerSettingsManager = await createProviderSettingsManager();
	const {
		coreServer,
		coreServer: { createUserInstructionConfigService },
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

	const userInstructionService = createUserInstructionConfigService({
		skills: {
			workspacePath: workspaceRoot,
			includePluginSkills: true,
			cwd,
		},
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	await userInstructionService.start().catch(() => {});
	let userInstructionServiceDisposed = false;
	const stopUserInstructionService = () => {
		if (userInstructionServiceDisposed) {
			return;
		}
		userInstructionServiceDisposed = true;
		userInstructionService.stop();
	};
	registerDisposable(stopUserInstructionService);
	try {
		const persistedClineAccountId = providerSettingsManager
			.getProviderSettings("cline")
			?.auth?.accountId?.trim();
		if (persistedClineAccountId) {
			setCliFeatureFlagsAccountContext({ id: persistedClineAccountId });
		}
		refreshCliFeatureFlagsInBackground();
		const lastUsedProviderSettings =
			providerSettingsManager.getLastUsedProviderSettings({
				isClinePassEnabled:
					getCliFeatureFlagsService().getBooleanFlagEnabled("ext-cline-pass"),
			});
		const provider = normalizeProviderId(
			args.provider?.trim() || lastUsedProviderSettings?.provider || "cline",
		);
		let selectedProviderSettings =
			providerSettingsManager.getProviderSettings(provider);
		const persistedApiKey = getPersistedProviderApiKey(
			provider,
			selectedProviderSettings,
		);
		const providedApiKey = args.key?.trim() || undefined;
		let apiKey = providedApiKey || persistedApiKey || undefined;

		const isYoloMode = args.mode === "yolo";
		const isZenMode = args.mode === "zen";

		// In headless mode (yolo / json / piped stdin without --tui),
		// don't attempt browser-based OAuth. Authentication may still resolve at
		// runtime from environment-based provider auth or persisted OAuth tokens.
		const isHeadless =
			isYoloMode ||
			isZenMode ||
			args.outputMode === "json" ||
			(!process.stdin.isTTY && !args.interactive);
		const isInteractive = (args.interactive || !args.prompt) && !isHeadless;

		if (!apiKey && isOAuthProvider(provider) && !isHeadless && !isInteractive) {
			const oauthResult = await ensureOAuthProviderApiKey({
				providerId: provider,
				currentApiKey: apiKey,
				existingSettings: selectedProviderSettings,
				providerSettingsManager,
				io: { writeln, writeErr },
			});
			selectedProviderSettings =
				oauthResult?.selectedProviderSettings ?? selectedProviderSettings;
			apiKey = oauthResult?.apiKey ?? apiKey;
		}

		let knownModels: Config["knownModels"];
		try {
			const persistedProviderConfig = providerSettingsManager.getProviderConfig(
				provider,
				{
					includeKnownModels: false,
				},
			);
			const catalogOptions = isInteractive
				? {
						loadLatestOnInit: true,
						loadPrivateOnAuth: true,
						failOnError: false,
					}
				: undefined;
			const resolvedProviderConfig = await coreServer.resolveProviderConfig(
				provider,
				catalogOptions,
				persistedProviderConfig,
			);
			knownModels = resolvedProviderConfig?.knownModels;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[model-catalog] catalog resolution failed (${message})${c.reset}`,
			);
		}
		const knownModelIds = knownModels ? Object.keys(knownModels) : [];
		const resolvedReasoning = resolveCliReasoning({
			thinking: args.thinking,
			thinkingExplicitlySet: args.thinkingExplicitlySet,
			reasoningEffort: args.reasoningEffort,
			persistedReasoning: selectedProviderSettings?.reasoning,
		});
		const { createCliLoggerAdapter } = await import("./logging/adapter");
		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "main",
		});
		loggerAdapter.core.log("CLI run started", {
			interactive: args.interactive === true,
			hasPrompt: !!args.prompt?.trim(),
			cwd,
		});

		const persistedPrefs = readGlobalSettings();
		const config: Config = {
			providerId: provider,
			modelId:
				args.model ??
				selectedProviderSettings?.model ??
				knownModelIds[0] ??
				"anthropic/claude-sonnet-4.6",
			apiKey: apiKey ?? "",
			knownModels,
			systemPrompt: await resolveSystemPrompt({
				cwd,
				explicitSystemPrompt: args.systemPrompt,
				providerId: provider,
				mode: args.mode ?? persistedPrefs.mode ?? "act",
			}),
			execution: {
				maxConsecutiveMistakes: args.retries ?? 3,
			},
			checkpoint: CLI_DEFAULT_CHECKPOINT_CONFIG,
			compaction: buildCliCompactionConfig(
				args.compactionMode ?? persistedPrefs.compactionMode,
			),
			timeoutSeconds: args.timeoutSeconds,
			sandbox: sandboxEnabled,
			sandboxDataDir,
			verbose: args.verbose ?? persistedPrefs.verbose ?? false,
			thinking: resolvedReasoning.thinking,
			reasoningEffort: resolvedReasoning.reasoningEffort,
			outputMode: args.outputMode,
			mode: (args.mode ?? persistedPrefs.mode ?? "act") as Config["mode"],
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			telemetry: getCliTelemetryService(loggerAdapter.core),
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: !isYoloMode,
			enableAgentTeams: !isYoloMode,
			enableTools: true,
			cwd,
			workspaceRoot,
			extensionContext: {
				client: { name: "cline-cli" },
				workspace: {
					rootPath: workspaceRoot,
					cwd,
					workspaceName: basename(cwd),
					ide: "Terminal Shell",
					platform: process.platform,
				},
				logger: loggerAdapter.core,
			},
			teamName: !isYoloMode ? args.teamName?.trim() || undefined : undefined,
		};
		try {
			// For OAuth providers, don't write the resolved key into apiKey;
			// the token lives in auth.accessToken and apiKey is reserved for
			// migrated/manual keys.
			const persistApiKey =
				// Persist explicit `-k/--key` even for OAuth-capable providers.
				providedApiKey
					? { apiKey: providedApiKey }
					: apiKey && !isOAuthProvider(provider)
						? { apiKey }
						: {};
			providerSettingsManager.saveProviderSettings({
				...(selectedProviderSettings ?? {}),
				provider,
				model: config.modelId,
				...persistApiKey,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[provider-settings] failed to persist selection (${message})${c.reset}`,
			);
		}
		// Check for piped input (skip when stdin is not a real pipe/file, e.g. headless CI).
		// Guard `isTTY` first so we never block on fd 0 when stdin is a terminal (and avoid
		// redundant fstat work). `stdinHasPipedInput` also checks `isTTY`, but callers may hit
		// inconsistent state in tests or embedded hosts.
		if (!process.stdin.isTTY && stdinHasPipedInput() && !args.interactive) {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) {
				chunks.push(chunk as Buffer);
			}
			const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();

			if (pipedInput) {
				const prompt = args.prompt
					? `${args.prompt}\n\n${pipedInput}`
					: pipedInput;
				const rewrittenTeamPrompt = rewriteTeamPrompt(prompt);
				if (rewrittenTeamPrompt.kind === "usage") {
					writeln(TEAM_COMMAND_USAGE);
					return;
				}
				const pipedEffectivePrompt =
					rewrittenTeamPrompt.kind === "rewritten"
						? rewrittenTeamPrompt.prompt
						: prompt;
				if (isZenMode) {
					const { runZen } = await import("./runtime/run-zen");
					await runZen(pipedEffectivePrompt, config, userInstructionService);
					return;
				}
				await runAgent(pipedEffectivePrompt, config, userInstructionService);
				return;
			}
		}

		// Interactive mode: zen is incompatible because there is no terminal UI
		// to surface results and nothing waits for the background task.
		if (args.interactive || !args.prompt) {
			if (isZenMode) {
				writeErr(
					args.interactive
						? "--zen is not compatible with interactive mode."
						: "--zen requires a prompt.",
				);
				process.exitCode = 1;
				return;
			}
			const runInteractive = await loadInteractiveRuntimeModule();
			let initialView: "chat" | "config" | undefined;
			if (launchConfigView) {
				initialView = "config";
			} else if (resumeSessionId) {
				initialView = "chat";
			}
			const initialClineProviderSettings =
				provider === "cline" ? selectedProviderSettings : undefined;
			let initialNotice:
				| import("./kanban-migration/notice").CliMigrationNotice
				| undefined;
			let markInitialNoticeShown:
				| ((
						notice: import("./kanban-migration/notice").CliMigrationNotice,
				  ) => void)
				| undefined;
			if (!launchConfigView && process.stdin.isTTY && process.stdout.isTTY) {
				const { getClineCliMigrationNotice, markClineCliMigrationNoticeShown } =
					await import("./kanban-migration/notice");
				initialNotice = getClineCliMigrationNotice();
				if (initialNotice) {
					markInitialNoticeShown = () => {
						markClineCliMigrationNoticeShown();
					};
				}
			}
			await runInteractive(config, userInstructionService, resumeSessionId, {
				initialPrompt: args.prompt,
				clineApiBaseUrl: initialClineProviderSettings?.baseUrl,
				clineProviderSettings: initialClineProviderSettings,
				initialView,
				initialNotice,
				onInitialNoticeShown: markInitialNoticeShown,
			});
			return;
		}

		// Single prompt mode
		const rewrittenTeamPrompt = rewriteTeamPrompt(args.prompt);
		if (rewrittenTeamPrompt.kind === "usage") {
			writeln(TEAM_COMMAND_USAGE);
			return;
		}
		const effectivePrompt =
			rewrittenTeamPrompt.kind === "rewritten"
				? rewrittenTeamPrompt.prompt
				: args.prompt;

		// Zen mode: dispatch the task to the background hub and exit. The CLI
		// does not stay connected to stream output; completion is delivered via
		// the hub's existing ui.notify broadcast (picked up by the menubar app
		// when installed).
		if (isZenMode) {
			const { runZen } = await import("./runtime/run-zen");
			await runZen(effectivePrompt, config, userInstructionService);
			return;
		}

		await runAgent(effectivePrompt, config, userInstructionService);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionService();
	}
}
