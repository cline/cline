import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentConfig,
	HookStage,
	Tool,
	WorkspaceInfo,
} from "@clinebot/shared";
import { SubprocessSandbox } from "../../runtime/subprocess-sandbox";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import type { PluginTargeting } from "./plugin-targeting";

export interface PluginSandboxOptions extends PluginTargeting {
	pluginPaths: string[];
	exportName?: string;
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
}

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];

type SandboxedContributionDescriptor = {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	metadata?: Record<string, unknown>;
};

type SandboxedPluginDescriptor = {
	pluginId: string;
	pluginPath: string;
	name: string;
	manifest: AgentExtension["manifest"];
	contributions: {
		tools: SandboxedContributionDescriptor[];
		commands: SandboxedContributionDescriptor[];
		messageBuilders: SandboxedContributionDescriptor[];
		providers: SandboxedContributionDescriptor[];
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
			messageBuilders: descriptor.contributions?.messageBuilders ?? [],
			providers: descriptor.contributions?.providers ?? [],
			shortcuts: descriptor.contributions?.shortcuts ?? [],
			flags: descriptor.contributions?.flags ?? [],
		},
	};
}

function isUnknownPluginIdError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Unknown sandbox plugin id:");
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
	];
	for (const candidate of candidates) {
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

/**
 * Map from hook stage names in the manifest to the property name on AgentExtension
 * and the corresponding hook method name inside the sandbox subprocess.
 */
const HOOK_BINDINGS: Array<{
	stage: HookStage;
	extensionKey: keyof AgentExtension;
	sandboxHookName: string;
}> = [
	{ stage: "input", extensionKey: "onInput", sandboxHookName: "onInput" },
	{
		stage: "session_start",
		extensionKey: "onSessionStart",
		sandboxHookName: "onSessionStart",
	},
	{
		stage: "run_start",
		extensionKey: "onRunStart",
		sandboxHookName: "onRunStart",
	},
	{
		stage: "iteration_start",
		extensionKey: "onIterationStart",
		sandboxHookName: "onIterationStart",
	},
	{
		stage: "turn_start",
		extensionKey: "onTurnStart",
		sandboxHookName: "onTurnStart",
	},
	{
		stage: "before_agent_start",
		extensionKey: "onBeforeAgentStart",
		sandboxHookName: "onBeforeAgentStart",
	},
	{
		stage: "tool_call_before",
		extensionKey: "onToolCall",
		sandboxHookName: "onToolCall",
	},
	{
		stage: "tool_call_after",
		extensionKey: "onToolResult",
		sandboxHookName: "onToolResult",
	},
	{
		stage: "turn_end",
		extensionKey: "onTurnEnd",
		sandboxHookName: "onTurnEnd",
	},
	{
		stage: "stop_error",
		extensionKey: "onAgentError",
		sandboxHookName: "onAgentError",
	},
	{
		stage: "iteration_end",
		extensionKey: "onIterationEnd",
		sandboxHookName: "onIterationEnd",
	},
	{
		stage: "run_end",
		extensionKey: "onRunEnd",
		sandboxHookName: "onRunEnd",
	},
	{
		stage: "session_shutdown",
		extensionKey: "onSessionShutdown",
		sandboxHookName: "onSessionShutdown",
	},
	{
		stage: "runtime_event",
		extensionKey: "onRuntimeEvent",
		sandboxHookName: "onRuntimeEvent",
	},
	{ stage: "error", extensionKey: "onError", sandboxHookName: "onError" },
];

function hasHookStage(extension: AgentExtension, stage: HookStage): boolean {
	return extension.manifest.hookStages?.includes(stage) === true;
}

function withTimeoutFallback(
	timeoutMs: number | undefined,
	fallback: number,
): number {
	return typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : fallback;
}

export async function loadSandboxedPlugins(
	options: PluginSandboxOptions,
): Promise<
	{
		extensions: AgentConfig["extensions"];
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
	const importTimeoutMs = withTimeoutFallback(options.importTimeoutMs, 4000);
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
		workspaceInfo: options.workspaceInfo,
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
			const extension: AgentExtension = {
				name: descriptor.name,
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
					registerSimpleContributions(api, descriptor);
				},
			};

			bindHooks(
				extension,
				sandbox,
				descriptor.pluginId,
				hookTimeoutMs,
				reinitialize,
			);

			return extension;
		},
	);

	return {
		extensions,
		failures: initialized.failures,
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
		const tool: Tool = {
			name: td.name,
			description: td.description ?? "",
			inputSchema: (td.inputSchema ?? {
				type: "object",
				properties: {},
			}) as Tool["inputSchema"],
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

function registerSimpleContributions(
	api: AgentExtensionApi,
	descriptor: SandboxedPluginDescriptor,
): void {
	for (const rd of descriptor.contributions?.messageBuilders ?? []) {
		api.registerMessageBuilder({
			name: rd.name,
			build: (m) => m,
		});
	}

	for (const pd of descriptor.contributions?.providers ?? []) {
		api.registerProvider({
			name: pd.name,
			description: pd.description,
			metadata: pd.metadata,
		});
	}
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

function bindHooks(
	extension: AgentExtension,
	sandbox: SubprocessSandbox,
	pluginId: string,
	hookTimeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const { stage, extensionKey, sandboxHookName } of HOOK_BINDINGS) {
		if (hasHookStage(extension, stage)) {
			const handler = makeHookHandler(
				sandbox,
				pluginId,
				sandboxHookName,
				hookTimeoutMs,
				reinitialize,
			);
			// Each hook property on AgentExtension accepts (payload: unknown) => Promise<unknown>.
			// TypeScript cannot narrow a union of optional callback keys via computed access,
			// so we use Object.assign to set the property safely.
			Object.assign(extension, { [extensionKey]: handler });
		}
	}
}
