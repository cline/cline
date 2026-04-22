import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { ToolPolicy } from "@clinebot/core";

import { registerDisposable } from "@clinebot/shared";
import type { Command } from "commander";
import {
	addRootOptions,
	CommanderError,
	commanderToParsedArgs,
	createProgram,
} from "./commands/program";
import { autoUpdateOnStartup } from "./commands/update";
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
import { rewriteTeamPrompt, TEAM_COMMAND_USAGE } from "./utils/team-command";
import type { Config } from "./utils/types";

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
	const { ProviderSettingsManager } = await import("@clinebot/core");
	return new ProviderSettingsManager();
}

async function loadCliRuntimeModules() {
	const [coreServer, prompt, runAgentModule] = await Promise.all([
		import("@clinebot/core"),
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

function resolveCwdArg(argv: string[]): string | undefined {
	const longIndex = argv.indexOf("--cwd");
	if (longIndex >= 0 && longIndex + 1 < argv.length) {
		const value = argv[longIndex + 1]?.trim();
		if (value) {
			return value;
		}
	}
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== "-c") {
			continue;
		}
		const value = argv[index + 1]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

function shouldPrewarmCliHub(argv: string[]): boolean {
	if (argv.includes("--yolo") || argv.includes("-y")) {
		return false;
	}
	const subcommand = argv.find((arg) => arg && !arg.startsWith("-"))?.trim();
	return subcommand !== "hub";
}

/**
 * Two-pass approach for --config: a quick scan of process.argv extracts the
 * config directory before commander parses, because setHomeDir() must run
 * before any code that reads the home/config directory.
 */
function resolveConfigDirArg(argv: string[]): string | undefined {
	const index = argv.indexOf("--config");
	if (index < 0 || index + 1 >= argv.length) {
		return undefined;
	}
	const value = argv[index + 1]?.trim();
	return value ? value : undefined;
}

export async function runCli(): Promise<void> {
	installStreamErrorGuards();
	autoUpdateOnStartup();

	const cliArgs = process.argv.slice(2);
	const configDir = resolveConfigDirArg(cliArgs);
	const { setClineDir, setHomeDir } = await import("@clinebot/shared/storage");
	if (configDir) {
		setClineDir(configDir);
	}
	setHomeDir(homedir());
	let launchConfigView = false;

	const normalizedArgs = normalizeAutoApproveArgs(cliArgs);
	if (
		shouldPrewarmCliHub(normalizedArgs) &&
		process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase() !== "local" &&
		!process.env.CLINE_VCR?.trim()
	) {
		const startupCwd = resolveCwdArg(normalizedArgs) ?? process.cwd();
		const startupWorkspaceRoot = resolveWorkspaceRoot(startupCwd);
		try {
			const { prewarmCliHubServer } = await import("./utils/hub-runtime");
			prewarmCliHubServer(startupWorkspaceRoot);
		} catch {
			// Defer hard failures to the command/runtime path; startup prewarm is best-effort.
		}
	}

	// Subcommand routing via Commander
	const ctx: { exitCode?: number; resumeSessionId?: string } = {};
	const io = { writeln, writeErr };
	const program = createProgram();
	// Re-enable built-in help/version output for the routing program
	program.configureOutput({
		writeOut: (str: string) => process.stdout.write(str),
		writeErr: (str: string) => process.stderr.write(str),
	});
	// Default action handles non-subcommand args (e.g. prompt text)
	program.action(() => {});
	let taskParsedProgram: Command | undefined;

	// Auth subcommand — defines its own options so commander parses them
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
		.option("--config <dir>", "configuration directory")
		.option("-c, --cwd <path>", "Working directory")
		.option("-v, --verbose", "Show verbose output")
		.action(async (positionalProvider: string | undefined) => {
			const opts = authCmd.opts<{
				provider?: string;
				apikey?: string;
				modelid?: string;
				baseurl?: string;
				config?: string;
				cwd?: string;
				verbose?: boolean;
			}>();
			const { runAuthCommand } = await import("./commands/auth");
			const providerSettingsManager = await createProviderSettingsManager();
			ctx.exitCode = await runAuthCommand({
				providerSettingsManager,
				explicitProvider: opts.provider ?? positionalProvider,
				apikey: opts.apikey,
				modelid: opts.modelid,
				baseurl: opts.baseurl,
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
	const connectCmd = program
		.command("connect")
		.description("Connect to an editor or IDE adapter")
		.argument("[adapter]", "Adapter to connect")
		.option("--stop", "Stop running connector(s)")
		.allowUnknownOption()
		.passThroughOptions()
		.addHelpText(
			"after",
			"\nRun 'connect <adapter> --help' for adapter-specific options.",
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
			} else {
				writeln(`\nAdapters:\n${formatAdapterList()}`);
				connectCmd.help();
			}
		});

	const createDevRuntimeCommand = async () => {
		const { createDevCommand } = await import("./commands/dev");
		return createDevCommand(io, (code) => {
			ctx.exitCode = code;
		});
	};

	program
		.command("dev")
		.description("Developer tools and utilities")
		.allowUnknownOption()
		.allowExcessArguments()
		.passThroughOptions()
		.addHelpText("after", "\nCommands:\n  log  Open the CLI log file\n")
		.action(async (_opts: unknown, cmd: Command) => {
			const devCmd = await createDevRuntimeCommand();
			await devCmd.parseAsync(cmd.args, { from: "user" });
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
		.action(async (_opts: unknown, cmd: Command) => {
			const doctorCmd = await createDoctorRuntimeCommand();
			await doctorCmd.parseAsync(cmd.args, { from: "user" });
		});

	const historyCmd = program
		.command("history")
		.alias("h")
		.description("List session history or manage saved sessions")
		.option("--json", "Output as JSON")
		.option("--limit <count>", "Maximum number of sessions to show", "200")
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
				workspaceRoot: resolveWorkspaceRoot(
					program.opts().cwd ?? process.cwd(),
				),
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

	const checkpointCmd = program
		.command("checkpoint")
		.description("Inspect or restore session checkpoints")
		.option("--json", "Output as JSON")
		.option("--session-id <id>", "Session ID to inspect")
		.option("--config <dir>", "configuration directory")
		.action(() => {
			checkpointCmd.outputHelp();
			ctx.exitCode = 0;
		});

	const checkpointStatusCmd = checkpointCmd
		.command("status")
		.description("Show the latest checkpoint for a session")
		.option("--session-id <id>", "Session ID to inspect")
		.action(async () => {
			const opts = checkpointStatusCmd.opts();
			const outputMode =
				program.opts().json || checkpointCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runCheckpointStatus } = await import("./commands/checkpoint");
			ctx.exitCode = await runCheckpointStatus({
				sessionId: opts.sessionId ?? checkpointCmd.opts().sessionId,
				outputMode,
				io,
			});
		});

	const checkpointListCmd = checkpointCmd
		.command("list")
		.description("List checkpoints for a session")
		.option("--session-id <id>", "Session ID to inspect")
		.action(async () => {
			const opts = checkpointListCmd.opts();
			const outputMode =
				program.opts().json || checkpointCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runCheckpointList } = await import("./commands/checkpoint");
			ctx.exitCode = await runCheckpointList({
				sessionId: opts.sessionId ?? checkpointCmd.opts().sessionId,
				outputMode,
				io,
			});
		});

	const checkpointRestoreCmd = checkpointCmd
		.command("restore")
		.description("Restore a checkpoint into the current working tree")
		.argument("[selector]", 'Checkpoint selector: "latest" or 1-based index')
		.option("--session-id <id>", "Session ID to inspect")
		.option("-y, --yes", "Skip confirmation prompt")
		.action(async (selector: string | undefined) => {
			const opts = checkpointRestoreCmd.opts();
			const outputMode =
				program.opts().json || checkpointCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			const { runCheckpointRestore } = await import("./commands/checkpoint");
			ctx.exitCode = await runCheckpointRestore({
				sessionId: opts.sessionId ?? checkpointCmd.opts().sessionId,
				selector,
				yes: opts.yes === true,
				outputMode,
				io,
			});
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

	// 'task' is syntactic sugar for the default prompt flow.
	// Re-parse everything after 'task'/'t' through a fresh root program
	// so that global options (--model, --timeout, etc.) are properly resolved.
	const taskCmd = program
		.command("task")
		.alias("t")
		.description("Run a task with the given prompt")
		.argument("[prompt]", "Task prompt (starts task immediately)")
		.allowUnknownOption()
		.allowExcessArguments()
		.enablePositionalOptions()
		.passThroughOptions();
	addRootOptions(taskCmd);
	taskCmd.action(
		async (_options: Record<string, unknown>, taskCmd: Command) => {
			const rootParser = createProgram();
			rootParser.action(() => {});
			try {
				await rootParser.parseAsync(normalizeAutoApproveArgs(taskCmd.args), {
					from: "user",
				});
			} catch (err) {
				if (err instanceof CommanderError) {
					throw err;
				}
				throw err;
			}
			taskParsedProgram = rootParser;
		},
	);

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

	try {
		await program.parseAsync(normalizedArgs, { from: "user" });
	} catch (err: unknown) {
		if (err instanceof CommanderError) {
			if (err.exitCode !== 0) {
				if (err.message.includes("taskId")) {
					writeErr("--taskId requires <id>");
				} else {
					writeErr(err.message);
				}
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

	// Default flow: no subcommand matched, or fall-through from config/history/task.
	// When 'task'/'t' was used, options were re-parsed into taskParsedProgram.
	let args = commanderToParsedArgs(taskParsedProgram ?? program);
	const cwd = args.cwd ?? process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	const sandboxEnabled =
		args.sandbox || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.sandboxDir,
	});

	let resumeSessionId: string | undefined = ctx.resumeSessionId;
	if (resumeSessionId) {
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	}

	if (args.taskId !== undefined) {
		const sessionId = args.taskId.trim();
		if (!sessionId) {
			writeErr("--taskId requires <id>");
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

	if (args.invalidReasoningEffort) {
		writeErr(
			`invalid reasoning effort "${args.invalidReasoningEffort}" (expected "none", "low", "medium", "high", or "xhigh")`,
		);
		process.exitCode = 1;
		return;
	}
	if (args.invalidAutoApprove) {
		writeErr(
			`invalid autoapprove value "${args.invalidAutoApprove}" (expected "true" or "false")`,
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
	if (args.invalidMaxConsecutiveMistakes) {
		writeln(
			`${c.dim}[warn] ignoring invalid --max-consecutive-mistakes value "${args.invalidMaxConsecutiveMistakes}" (expected integer >= 1)${c.reset}`,
		);
	}
	if (args.hooksDir?.trim()) {
		process.env.CLINE_HOOKS_DIR = args.hooksDir.trim();
	}
	setCurrentOutputMode(args.outputMode);
	const defaultToolAutoApprove = args.defaultToolAutoApprove;
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: defaultToolAutoApprove,
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

	// Keep command-style subcommands on a narrow path. Runtime-only imports pull
	// in provider resolution, config watchers, and session startup wiring that
	// should only load when the CLI is actually starting an agent session.
	const providerSettingsManager = await createProviderSettingsManager();
	const {
		coreServer,
		coreServer: {
			createTeamName,
			createUserInstructionConfigWatcher,
			loadRulesForSystemPromptFromWatcher,
		},
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

	const userInstructionWatcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: workspaceRoot },
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	await userInstructionWatcher.start().catch(() => {});
	let watcherDisposed = false;
	const stopUserInstructionWatcher = () => {
		if (watcherDisposed) {
			return;
		}
		watcherDisposed = true;
		userInstructionWatcher.stop();
	};
	registerDisposable(stopUserInstructionWatcher);
	try {
		const lastUsedProviderSettings =
			providerSettingsManager.getLastUsedProviderSettings();
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

		// In headless mode (yolo / json / piped stdin without --interactive),
		// don't attempt browser-based OAuth. Authentication may still resolve at
		// runtime from environment-based provider auth or persisted OAuth tokens.
		const isHeadless =
			args.yolo ||
			args.outputMode === "json" ||
			(!process.stdin.isTTY && !args.interactive);

		if (!apiKey && isOAuthProvider(provider) && !isHeadless) {
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
		if (args.liveModelCatalog) {
			try {
				const resolvedProviderConfig = await coreServer.resolveProviderConfig(
					provider,
					{
						loadLatestOnInit: true,
						loadPrivateOnAuth: true,
						failOnError: false,
					},
				);
				knownModels = resolvedProviderConfig?.knownModels;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				writeln(
					`${c.dim}[model-catalog] latest refresh failed, using bundled defaults (${message})${c.reset}`,
				);
			}
		}
		const knownModelIds = knownModels ? Object.keys(knownModels) : [];
		const effectiveReasoningEffort =
			args.reasoningEffort ?? (args.thinking ? "medium" : "none");
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
				rules: loadRulesForSystemPromptFromWatcher(userInstructionWatcher),
				mode: args.yolo ? "yolo" : undefined,
			}),
			maxIterations: args.maxIterations,
			execution: {
				maxConsecutiveMistakes: args.maxConsecutiveMistakes ?? 3,
			},
			compaction: {
				enabled: true,
			},
			timeoutSeconds: args.timeoutSeconds,
			sandbox: sandboxEnabled,
			sandboxDataDir,
			showUsage: args.showUsage,
			verbose: args.verbose,
			thinking: effectiveReasoningEffort !== "none",
			reasoningEffort:
				effectiveReasoningEffort === "none"
					? undefined
					: effectiveReasoningEffort,
			outputMode: args.outputMode,
			mode: args.yolo === true ? "yolo" : args.mode,
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: args.yolo !== true,
			enableAgentTeams: args.yolo !== true,
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
			teamName:
				args.yolo !== true
					? args.teamName?.trim() || createTeamName()
					: undefined,
		};
		try {
			// For OAuth providers, don't write the resolved key into apiKey —
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
				if (rewrittenTeamPrompt.kind === "rewritten") {
					await runAgent(
						rewrittenTeamPrompt.prompt,
						config,
						userInstructionWatcher,
					);
					return;
				}
				await runAgent(prompt, config, userInstructionWatcher);
				return;
			}
		}

		// Interactive mode
		if (args.interactive || !args.prompt) {
			const runInteractive = await loadInteractiveRuntimeModule();
			await runInteractive(config, userInstructionWatcher, resumeSessionId, {
				clineApiBaseUrl: selectedProviderSettings?.baseUrl,
				clineProviderSettings: selectedProviderSettings,
				initialView: launchConfigView ? "config" : "chat",
			});
			return;
		}

		// Single prompt mode
		const rewrittenTeamPrompt = rewriteTeamPrompt(args.prompt);
		if (rewrittenTeamPrompt.kind === "usage") {
			writeln(TEAM_COMMAND_USAGE);
			return;
		}
		if (rewrittenTeamPrompt.kind === "rewritten") {
			await runAgent(
				rewrittenTeamPrompt.prompt,
				config,
				userInstructionWatcher,
			);
			return;
		}
		await runAgent(args.prompt, config, userInstructionWatcher);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionWatcher();
	}
}
