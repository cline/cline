import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentConfig,
	AgentExtensionAutomationEventType,
	AgentExtensionRule,
	AgentRuntimeHooks,
	AgentTool,
	Message,
	PluginSetupContext,
	WorkspaceInfo,
} from "@cline/shared";
import { SubprocessSandbox } from "../../runtime/tools/subprocess-sandbox";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import type { PluginTargeting } from "./plugin-targeting";

export type SandboxedPluginSetupContext = Pick<
	PluginSetupContext,
	"session" | "client" | "user" | "workspaceInfo" | "logger"
>;

export interface PluginSandboxOptions extends PluginTargeting {
	pluginPaths: string[];
	exportName?: string;
	/**
	 * Max wall time for plugin module imports. Defaults to 4000 ms; falls back
	 * to the `CLINE_PLUGIN_IMPORT_TIMEOUT_MS` env var when this option is not
	 * set, allowing slower hosts (Windows cold-start, CI without warm caches)
	 * to raise the ceiling without touching code.
	 */
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	contributionTimeoutMs?: number;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
	/**
	 * The session's working directory. Forwarded to the sandbox subprocess so
	 * that `process.cwd()` returns the correct path inside the sandbox even
	 * when `--cwd` was passed without calling `process.chdir()` on the host.
	 */
	cwd?: string;
	/**
	 * Structured workspace and git metadata (branch, commit, remotes) generated
	 * at session startup. Forwarded to plugins via PluginSetupCtx.workspaceInfo
	 * so they can inspect git state without running their own commands.
	 */
	workspaceInfo?: WorkspaceInfo;
	session?: SandboxedPluginSetupContext["session"];
	client?: SandboxedPluginSetupContext["client"];
	user?: SandboxedPluginSetupContext["user"];
	/** Enables a logger bridge that forwards sandbox log calls to the host. */
	logger?: SandboxedPluginSetupContext["logger"];
}

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];
type SandboxedAgentExtension = AgentExtension & {
	/** Internal metadata used by settings surfaces that need source paths. */
	__clinePluginPath?: string;
};

type SandboxedContributionDescriptor = {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	metadata?: Record<string, unknown>;
};

type SandboxedRuleDescriptor = Omit<AgentExtensionRule, "id" | "content"> & {
	id: string;
	ruleId: string;
	content?: string;
	hasContentHandler?: boolean;
};

type SandboxedAutomationEventTypeDescriptor =
	AgentExtensionAutomationEventType & {
		id: string;
	};

type SandboxedPluginDescriptor = {
	pluginId: string;
	pluginPath: string;
	name: string;
	manifest: AgentExtension["manifest"];
	hooks?: Array<keyof AgentRuntimeHooks>;
	contributions: {
		tools: SandboxedContributionDescriptor[];
		commands: SandboxedContributionDescriptor[];
		rules: SandboxedRuleDescriptor[];
		messageBuilders: SandboxedContributionDescriptor[];
		providers: SandboxedContributionDescriptor[];
		automationEventTypes: SandboxedAutomationEventTypeDescriptor[];
		shortcuts?: SandboxedContributionDescriptor[];
		flags?: SandboxedContributionDescriptor[];
	};
};

type SandboxedInitializeResult = {
	plugins: SandboxedPluginDescriptor[];
} & PluginLoadDiagnostics;

function normalizeDescriptor(
	descriptor: SandboxedPluginDescriptor,
): SandboxedPluginDescriptor {
	return {
		...descriptor,
		contributions: {
			tools: descriptor.contributions?.tools ?? [],
			commands: descriptor.contributions?.commands ?? [],
			rules: descriptor.contributions?.rules ?? [],
			messageBuilders: descriptor.contributions?.messageBuilders ?? [],
			providers: descriptor.contributions?.providers ?? [],
			automationEventTypes:
				descriptor.contributions?.automationEventTypes ?? [],
			shortcuts: descriptor.contributions?.shortcuts ?? [],
			flags: descriptor.contributions?.flags ?? [],
		},
	};
}

function isUnknownPluginIdError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Unknown sandbox plugin id:");
}

function getPlatformPackageName(): string {
	const platform = process.platform === "win32" ? "windows" : process.platform;
	return `@cline/cli-${platform}-${process.arch}`;
}

function resolveBootstrapFromWrapper(): string | undefined {
	const wrapperPath = process.env.CLINE_WRAPPER_PATH?.trim();
	if (!wrapperPath) {
		return undefined;
	}
	try {
		const requireFromWrapper = createRequire(wrapperPath);
		const packageJsonPath = requireFromWrapper.resolve(
			`${getPlatformPackageName()}/package.json`,
		);
		const candidate = join(
			dirname(packageJsonPath),
			"extensions",
			"plugin-sandbox-bootstrap.js",
		);
		return existsSync(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}

function resolveBootstrapFromExecutable(): string | undefined {
	const execPath = process.execPath?.trim();
	if (!execPath) {
		return undefined;
	}
	const candidate = join(
		dirname(dirname(execPath)),
		"extensions",
		"plugin-sandbox-bootstrap.js",
	);
	return existsSync(candidate) ? candidate : undefined;
}

/**
 * Resolve the bootstrap for the sandbox subprocess.
 *
 * In production (bundled), the compiled `.js` file lives next to this module
 * and can be passed directly as a file to spawn. In development/test
 * (unbundled, where only the `.ts` source exists), we load the TypeScript
 * bootstrap through jiti from an inline script.
 */
function resolveBootstrap(): { file: string } | { script: string } {
	const dir = dirname(fileURLToPath(import.meta.url));
	const requireFromHere = createRequire(import.meta.url);
	// In dev, the bootstrap sits next to this file in src/extensions/.
	// In production, the main bundle is at dist/ and the bootstrap is emitted
	// under dist/extensions/. Keep the older dist/agents/ fallback for
	// compatibility with previously built layouts.
	const candidates = [
		join(dir, "plugin-sandbox-bootstrap.js"),
		join(dir, "extensions", "plugin-sandbox-bootstrap.js"),
		join(dir, "agents", "plugin-sandbox-bootstrap.js"),
		resolveBootstrapFromWrapper(),
		resolveBootstrapFromExecutable(),
	];
	for (const candidate of candidates.filter(
		(candidate): candidate is string => typeof candidate === "string",
	)) {
		if (existsSync(candidate)) return { file: candidate };
	}
	const tsPath = join(dir, "plugin-sandbox-bootstrap.ts");
	let jitiSpecifier = "jiti";
	try {
		jitiSpecifier = requireFromHere.resolve("jiti");
	} catch {
		// Fall back to bare specifier and let runtime resolution handle it.
	}
	return {
		script: [
			`const createJiti = require(${JSON.stringify(jitiSpecifier)});`,
			`const jiti = createJiti(${JSON.stringify(tsPath)}, { cache: false, requireCache: false, esmResolve: true, interopDefault: false });`,
			`Promise.resolve(jiti.import(${JSON.stringify(tsPath)}, {})).catch((error) => {`,
			"  console.error(error);",
			"  process.exitCode = 1;",
			"});",
		].join("\n"),
	};
}

const BOOTSTRAP = resolveBootstrap();

function withTimeoutFallback(
	timeoutMs: number | undefined,
	fallback: number,
	envVarName?: string,
): number {
	if (typeof timeoutMs === "number" && timeoutMs > 0) {
		return timeoutMs;
	}
	if (envVarName) {
		const raw = process.env[envVarName];
		if (raw) {
			// Number() is stricter than parseInt: it rejects values with
			// trailing non-numeric characters (e.g. "4000ms" -> NaN) so a
			// malformed env value falls back to the default instead of
			// silently consuming its numeric prefix.
			const parsed = Number(raw);
			if (Number.isInteger(parsed) && parsed > 0) {
				return parsed;
			}
		}
	}
	return fallback;
}

export async function loadSandboxedPlugins(
	options: PluginSandboxOptions,
): Promise<
	{
		extensions: AgentConfig["extensions"];
		pluginPaths: string[];
		shutdown: () => Promise<void>;
	} & PluginLoadDiagnostics
> {
	const sandbox = new SubprocessSandbox({
		name: "plugin-sandbox",
		...("file" in BOOTSTRAP
			? { bootstrapFile: BOOTSTRAP.file }
			: { bootstrapScript: BOOTSTRAP.script }),
		onEvent: options.onEvent,
	});
	const importTimeoutMs = withTimeoutFallback(
		options.importTimeoutMs,
		4000,
		"CLINE_PLUGIN_IMPORT_TIMEOUT_MS",
	);
	const hookTimeoutMs = withTimeoutFallback(options.hookTimeoutMs, 3000);
	const contributionTimeoutMs = withTimeoutFallback(
		options.contributionTimeoutMs,
		60_000,
	);
	const initArgs = {
		pluginPaths: options.pluginPaths,
		exportName: options.exportName,
		providerId: options.providerId,
		modelId: options.modelId,
		cwd: options.cwd,
		session: options.session,
		client: options.client,
		user: options.user,
		workspaceInfo: options.workspaceInfo,
		loggerEnabled: Boolean(options.logger),
	};

	// Guard against concurrent re-initialization when multiple tools/hooks
	// fail simultaneously with "Unknown sandbox plugin id:".
	let reinitPromise: Promise<void> | undefined;
	const reinitialize = (): Promise<void> => {
		reinitPromise ??= sandbox
			.call<void>("initialize", initArgs, { timeoutMs: importTimeoutMs })
			.finally(() => {
				reinitPromise = undefined;
			});
		return reinitPromise;
	};

	let initialized: SandboxedInitializeResult;
	try {
		initialized = await sandbox.call<SandboxedInitializeResult>(
			"initialize",
			initArgs,
			{ timeoutMs: importTimeoutMs },
		);
	} catch (error) {
		await sandbox.shutdown().catch(() => {
			// Best-effort cleanup when sandbox initialization fails.
		});
		throw error;
	}
	const descriptors = initialized.plugins.map(normalizeDescriptor);

	const extensions: NonNullable<AgentConfig["extensions"]> = descriptors.map(
		(descriptor) => {
			const extension: SandboxedAgentExtension = {
				name: descriptor.name,
				__clinePluginPath: descriptor.pluginPath,
				manifest: descriptor.manifest,
				setup: (api: AgentExtensionApi) => {
					registerTools(
						api,
						sandbox,
						descriptor,
						contributionTimeoutMs,
						reinitialize,
					);
					registerCommands(
						api,
						sandbox,
						descriptor,
						contributionTimeoutMs,
						reinitialize,
					);
					registerRules(
						api,
						sandbox,
						descriptor,
						contributionTimeoutMs,
						reinitialize,
					);
					registerMessageBuilders(
						api,
						sandbox,
						descriptor,
						contributionTimeoutMs,
						reinitialize,
					);
					registerSimpleContributions(api, descriptor);
				},
			};

			extension.hooks = createSandboxRuntimeHooks(
				sandbox,
				descriptor,
				hookTimeoutMs,
				reinitialize,
			);

			return extension;
		},
	);

	return {
		extensions,
		failures: initialized.failures,
		pluginPaths: descriptors.map((descriptor) => descriptor.pluginPath),
		shutdown: async () => {
			await sandbox.shutdown();
		},
		warnings: initialized.warnings,
	};
}

// ---------------------------------------------------------------------------
// Contribution registration helpers
// ---------------------------------------------------------------------------

function registerTools(
	api: AgentExtensionApi,
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const td of descriptor.contributions?.tools ?? []) {
		const tool: AgentTool = {
			name: td.name,
			description: td.description ?? "",
			inputSchema: (td.inputSchema ?? {
				type: "object",
				properties: {},
			}) as AgentTool["inputSchema"],
			timeoutMs: td.timeoutMs,
			retryable: td.retryable,
			execute: async (input: unknown, context: unknown) => {
				try {
					return await sandbox.call(
						"executeTool",
						{
							pluginId: descriptor.pluginId,
							contributionId: td.id,
							input,
							context,
						},
						{ timeoutMs },
					);
				} catch (error) {
					if (!isUnknownPluginIdError(error)) {
						throw error;
					}
					await reinitialize();
					return await sandbox.call(
						"executeTool",
						{
							pluginId: descriptor.pluginId,
							contributionId: td.id,
							input,
							context,
						},
						{ timeoutMs },
					);
				}
			},
		};
		api.registerTool(tool);
	}
}

function registerCommands(
	api: AgentExtensionApi,
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const cd of descriptor.contributions?.commands ?? []) {
		api.registerCommand({
			name: cd.name,
			description: cd.description,
			handler: async (input: string) => {
				try {
					return await sandbox.call<string>(
						"executeCommand",
						{
							pluginId: descriptor.pluginId,
							contributionId: cd.id,
							input,
						},
						{ timeoutMs },
					);
				} catch (error) {
					if (!isUnknownPluginIdError(error)) {
						throw error;
					}
					await reinitialize();
					return await sandbox.call<string>(
						"executeCommand",
						{
							pluginId: descriptor.pluginId,
							contributionId: cd.id,
							input,
						},
						{ timeoutMs },
					);
				}
			},
		});
	}
}

function registerRules(
	api: AgentExtensionApi,
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const rule of descriptor.contributions?.rules ?? []) {
		api.registerRule({
			id: rule.ruleId,
			source: rule.source,
			content:
				rule.hasContentHandler === true
					? async () => {
							try {
								return await sandbox.call<string>(
									"resolveRuleContent",
									{
										pluginId: descriptor.pluginId,
										contributionId: rule.id,
									},
									{ timeoutMs },
								);
							} catch (error) {
								if (!isUnknownPluginIdError(error)) {
									throw error;
								}
								await reinitialize();
								return await sandbox.call<string>(
									"resolveRuleContent",
									{
										pluginId: descriptor.pluginId,
										contributionId: rule.id,
									},
									{ timeoutMs },
								);
							}
						}
					: (rule.content ?? ""),
		});
	}
}

function registerSimpleContributions(
	api: AgentExtensionApi,
	descriptor: SandboxedPluginDescriptor,
): void {
	for (const pd of descriptor.contributions?.providers ?? []) {
		api.registerProvider({
			name: pd.name,
			description: pd.description,
			metadata: pd.metadata,
		});
	}

	for (const eventType of descriptor.contributions?.automationEventTypes ??
		[]) {
		api.registerAutomationEventType({
			eventType: eventType.eventType,
			source: eventType.source,
			description: eventType.description,
			attributesSchema: eventType.attributesSchema,
			payloadSchema: eventType.payloadSchema,
			examples: eventType.examples,
			metadata: eventType.metadata,
		});
	}
}

function registerMessageBuilders(
	api: AgentExtensionApi,
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const bd of descriptor.contributions?.messageBuilders ?? []) {
		api.registerMessageBuilder({
			name: bd.name,
			async build(messages) {
				try {
					const result = await sandbox.call<unknown[]>(
						"buildMessages",
						{
							pluginId: descriptor.pluginId,
							contributionId: bd.id,
							messages,
						},
						{ timeoutMs },
					);
					return isMessageArray(result) ? result : messages;
				} catch (error) {
					if (!isUnknownPluginIdError(error)) {
						throw error;
					}
					await reinitialize();
					const result = await sandbox.call<unknown[]>(
						"buildMessages",
						{
							pluginId: descriptor.pluginId,
							contributionId: bd.id,
							messages,
						},
						{ timeoutMs },
					);
					return isMessageArray(result) ? result : messages;
				}
			},
		});
	}
}

function isMessageArray(value: unknown): value is Message[] {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				"role" in entry &&
				"content" in entry,
		)
	);
}

function makeHookHandler(
	sandbox: SubprocessSandbox,
	pluginId: string,
	hookName: string,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): (payload: unknown) => Promise<unknown> {
	return async (payload: unknown) => {
		try {
			return await sandbox.call(
				"invokeHook",
				{ pluginId, hookName, payload },
				{ timeoutMs },
			);
		} catch (error) {
			if (!isUnknownPluginIdError(error)) {
				throw error;
			}
			await reinitialize();
			return await sandbox.call(
				"invokeHook",
				{ pluginId, hookName, payload },
				{ timeoutMs },
			);
		}
	};
}

function createSandboxRuntimeHooks(
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	hookTimeoutMs: number,
	reinitialize: () => Promise<void>,
): Partial<AgentRuntimeHooks> | undefined {
	const hooks: Partial<
		Record<keyof AgentRuntimeHooks, (payload: unknown) => Promise<unknown>>
	> = {};
	for (const hookName of descriptor.hooks ?? []) {
		hooks[hookName] = makeHookHandler(
			sandbox,
			descriptor.pluginId,
			hookName,
			hookTimeoutMs,
			reinitialize,
		);
	}
	return Object.keys(hooks).length > 0
		? (hooks as Partial<AgentRuntimeHooks>)
		: undefined;
}
