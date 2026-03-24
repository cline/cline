import { fstatSync } from "node:fs";
import { homedir } from "node:os";
import type { ToolPolicy } from "@clinebot/core";
import { setClineDir, setHomeDir } from "@clinebot/core";
import type { Command } from "commander";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
	runAuthCommand,
} from "./commands/auth";
import {
	formatAdapterList,
	runConnectAdapter,
	runStopAllConnectors,
	runStopConnector,
} from "./commands/connect";
import { createDevCommand } from "./commands/dev";
import { createDoctorCommand } from "./commands/doctor";
import { showVersion } from "./commands/help";
import { runHookCommand, runHookWorkerCommand } from "./commands/hook";
import { createListCommand } from "./commands/list";
import {
	addRootOptions,
	CommanderError,
	commanderToParsedArgs,
	createProgram,
} from "./commands/program";
import { createScheduleCommand } from "./commands/schedule";
import { createCliLoggerAdapter } from "./logging/adapter";
import {
	configureSandboxEnvironment,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import {
	c,
	installStreamErrorGuards,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./utils/output";
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

function mergeToolPolicies(
	base: Record<string, ToolPolicy>,
	overrides: Record<string, ToolPolicy>,
): Record<string, ToolPolicy> {
	const out: Record<string, ToolPolicy> = { ...base };
	for (const [name, policy] of Object.entries(overrides)) {
		out[name] = { ...(out[name] ?? {}), ...policy };
	}
	return out;
}

async function createProviderSettingsManager() {
	const { ProviderSettingsManager } = await import("@clinebot/core/node");
	return new ProviderSettingsManager();
}

async function loadCliRuntimeModules() {
	const [coreServer, llms, prompt, runAgentModule] = await Promise.all([
		import("@clinebot/core/node"),
		import("@clinebot/llms"),
		import("./runtime/prompt"),
		import("./runtime/run-agent"),
	]);
	return {
		coreServer,
		llms,
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

	const cliArgs = process.argv.slice(2);
	const configDir = resolveConfigDirArg(cliArgs);
	if (configDir) {
		setClineDir(configDir);
	}
	setHomeDir(homedir());

	let launchConfigView = false;
	const normalizedArgs = cliArgs;

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

	program
		.command("config")
		.description("Show current configuration")
		.option("--config <dir>", "configuration directory")
		.action(() => {
			launchConfigView = true;
		});
	program
		.command("hook-worker")
		.allowUnknownOption()
		.allowExcessArguments()
		.action(async () => {
			ctx.exitCode = await runHookWorkerCommand(writeErr);
		});

	const connectCmd = program
		.command("connect")
		.description("Connect to an editor or IDE adapter")
		.argument("[adapter]", "Adapter to connect")
		.option("--stop", "Stop running connector(s)")
		.allowUnknownOption()
		.passThroughOptions()
		.addHelpText("after", () => `\nAdapters:\n${formatAdapterList()}`)
		.action(async (adapter: string | undefined) => {
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
				connectCmd.help();
			}
		});

	const devCmd = createDevCommand(io, (code) => {
		ctx.exitCode = code;
	});
	program.addCommand(devCmd);

	const doctorCmd = createDoctorCommand(io, (code) => {
		ctx.exitCode = code;
	});
	program.addCommand(doctorCmd);

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
				io,
			});
			if (typeof result === "string") {
				ctx.resumeSessionId = result;
			} else {
				ctx.exitCode = result;
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
				ctx.exitCode = 1;
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

	program
		.command("hook")
		.description("Handle a hook payload from stdin")
		.allowUnknownOption()
		.allowExcessArguments()
		.action(async () => {
			ctx.exitCode = await runHookCommand(io);
		});

	const listCmd = createListCommand(
		() => resolveWorkspaceRoot(program.opts().cwd ?? process.cwd()),
		() => {
			const outputMode =
				program.opts().json || listCmd.opts().json
					? ("json" as const)
					: ("text" as const);
			setCurrentOutputMode(outputMode);
			return outputMode;
		},
		io,
		(code) => {
			ctx.exitCode = code;
		},
	);
	program.addCommand(listCmd);

	const { createRpcCommand } = await import("./commands/rpc");
	const rpcCmd = createRpcCommand(io, (code) => {
		ctx.exitCode = code;
	});
	program.addCommand(rpcCmd);

	const scheduleCmd = createScheduleCommand(io, (code) => {
		ctx.exitCode = code;
	});
	program.addCommand(scheduleCmd);

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
				await rootParser.parseAsync(taskCmd.args, { from: "user" });
			} catch (err) {
				if (err instanceof CommanderError) {
					throw err;
				}
				throw err;
			}
			taskParsedProgram = rootParser;
		},
	);

	program
		.command("update")
		.description("[TODO] Check for updates and install if available")
		.allowUnknownOption()
		.allowExcessArguments()
		.option("-v, --verbose", "Show verbose output")
		.option("--config <dir>", "configuration directory")
		.action(async () => {
			const { requestRpcServerShutdown } = await import("@clinebot/rpc");
			const address = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
			requestRpcServerShutdown(address).catch(() => {});
			writeErr(
				"update command is not implemented yet (use your package manager to update manually)",
			);
			ctx.exitCode = 1;
		});

	program
		.command("version")
		.description("Show Cline CLI version number")
		.action(() => {
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
				process.exitCode = 1;
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
	const mergedToolPolicies = mergeToolPolicies({}, args.toolPolicies);
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: defaultToolAutoApprove,
		},
	};
	for (const [name, policy] of Object.entries(mergedToolPolicies)) {
		toolPolicies[name] = {
			enabled: policy.enabled,
			autoApprove: policy.autoApprove ?? defaultToolAutoApprove,
		};
	}

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
		coreServer: {
			createTeamName,
			createUserInstructionConfigWatcher,
			loadRulesForSystemPromptFromWatcher,
		},
		llms: { LlmsProviders: providers },
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

	const userInstructionWatcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: cwd },
		rules: { workspacePath: cwd },
		workflows: { workspacePath: cwd },
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
	process.on("exit", stopUserInstructionWatcher);
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
			selectedProviderSettings = oauthResult.selectedProviderSettings;
			apiKey = oauthResult.apiKey;
		}

		let knownModels: Config["knownModels"];
		if (args.liveModelCatalog) {
			try {
				const resolvedProviderConfig = await providers.resolveProviderConfig(
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
		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "main",
		});
		loggerAdapter.core?.info?.("CLI run started", {
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
			}),
			maxIterations: args.maxIterations,
			maxConsecutiveMistakes: args.maxConsecutiveMistakes ?? 3,
			timeoutSeconds: args.timeoutSeconds,
			sandbox: sandboxEnabled,
			sandboxDataDir,
			showUsage: args.showUsage,
			showTimings: args.showTimings,
			verbose: args.verbose,
			thinking: effectiveReasoningEffort !== "none",
			reasoningEffort:
				effectiveReasoningEffort === "none"
					? undefined
					: effectiveReasoningEffort,
			outputMode: args.outputMode,
			mode: args.mode,
			yolo: args.yolo === true,
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: args.enableSpawnAgent,
			enableAgentTeams: args.enableAgentTeams,
			enableTools: args.enableTools,
			cwd,
			workspaceRoot: resolveWorkspaceRoot(cwd),
			teamName: args.enableAgentTeams
				? args.teamName?.trim() || createTeamName()
				: undefined,
			missionLogIntervalSteps:
				typeof args.missionLogIntervalSteps === "number" &&
				Number.isFinite(args.missionLogIntervalSteps)
					? args.missionLogIntervalSteps
					: 3,
			missionLogIntervalMs:
				typeof args.missionLogIntervalMs === "number" &&
				Number.isFinite(args.missionLogIntervalMs)
					? args.missionLogIntervalMs
					: 120000,
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
		// Check for piped input (skip when stdin is not a real pipe/file, e.g. headless CI)
		if (stdinHasPipedInput() && !args.interactive) {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) {
				chunks.push(chunk as Buffer);
			}
			const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();

			if (pipedInput) {
				const prompt = args.prompt
					? `${args.prompt}\n\n${pipedInput}`
					: pipedInput;
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
		await runAgent(args.prompt, config, userInstructionWatcher);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionWatcher();
		process.off("exit", stopUserInstructionWatcher);
	}
}
