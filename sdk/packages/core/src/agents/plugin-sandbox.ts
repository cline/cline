import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, Tool } from "@clinebot/agents";
import { SubprocessSandbox } from "../runtime/sandbox/subprocess-sandbox";

export interface PluginSandboxOptions {
	pluginPaths: string[];
	exportName?: string;
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	contributionTimeoutMs?: number;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
}

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];
type HookStage =
	| "input"
	| "runtime_event"
	| "session_start"
	| "before_agent_start"
	| "tool_call_before"
	| "tool_call_after"
	| "turn_end"
	| "session_shutdown"
	| "error";

type SandboxedContributionDescriptor = {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	value?: string;
	defaultValue?: boolean | string | number;
	metadata?: Record<string, unknown>;
};

type SandboxedPluginDescriptor = {
	pluginId: string;
	name: string;
	manifest: AgentExtension["manifest"];
	contributions: {
		tools: SandboxedContributionDescriptor[];
		commands: SandboxedContributionDescriptor[];
		shortcuts: SandboxedContributionDescriptor[];
		flags: SandboxedContributionDescriptor[];
		messageRenderers: SandboxedContributionDescriptor[];
		providers: SandboxedContributionDescriptor[];
	};
};

/**
 * Resolve the bootstrap for the sandbox subprocess.
 *
 * In production (bundled), the compiled `.js` file lives next to this module
 * and can be passed directly as a file to spawn. In development/test
 * (unbundled, where only the `.ts` source exists), we transpile the source
 * with esbuild and pass it as an inline script.
 */
function resolveBootstrap(): { file: string } | { script: string } {
	const dir = dirname(fileURLToPath(import.meta.url));
	// In dev, the bootstrap sits next to this file in src/agents/.
	// In production, the main bundle is at dist/ but bootstrap is at dist/agents/.
	const candidates = [
		join(dir, "plugin-sandbox-bootstrap.js"),
		join(dir, "agents", "plugin-sandbox-bootstrap.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return { file: candidate };
	}
	// Development/test fallback: transpile the .ts source with esbuild.
	const tsPath = join(dir, "plugin-sandbox-bootstrap.ts");
	const source = readFileSync(tsPath, "utf8");
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require for dev-only dependency
	const { transformSync } = require("esbuild") as typeof import("esbuild");
	const result = transformSync(source, {
		loader: "ts",
		format: "esm",
		target: "node20",
	});
	return { script: result.code };
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
		extensionKey: "onAgentEnd",
		sandboxHookName: "onAgentEnd",
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
): Promise<{
	extensions: AgentConfig["extensions"];
	shutdown: () => Promise<void>;
}> {
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
		5000,
	);

	let descriptors: SandboxedPluginDescriptor[];
	try {
		descriptors = await sandbox.call<SandboxedPluginDescriptor[]>(
			"initialize",
			{
				pluginPaths: options.pluginPaths,
				exportName: options.exportName,
			},
			{ timeoutMs: importTimeoutMs },
		);
	} catch (error) {
		await sandbox.shutdown().catch(() => {
			// Best-effort cleanup when sandbox initialization fails.
		});
		throw error;
	}

	const extensions: NonNullable<AgentConfig["extensions"]> = descriptors.map(
		(descriptor) => {
			const extension: AgentExtension = {
				name: descriptor.name,
				manifest: descriptor.manifest,
				setup: (api: AgentExtensionApi) => {
					registerTools(api, sandbox, descriptor, contributionTimeoutMs);
					registerCommands(api, sandbox, descriptor, contributionTimeoutMs);
					registerSimpleContributions(api, descriptor);
				},
			};

			bindHooks(extension, sandbox, descriptor.pluginId, hookTimeoutMs);

			return extension;
		},
	);

	return {
		extensions,
		shutdown: async () => {
			await sandbox.shutdown();
		},
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
): void {
	for (const td of descriptor.contributions.tools) {
		const tool: Tool = {
			name: td.name,
			description: td.description ?? "",
			inputSchema: (td.inputSchema ?? {
				type: "object",
				properties: {},
			}) as Tool["inputSchema"],
			timeoutMs: td.timeoutMs,
			retryable: td.retryable,
			execute: async (input: unknown, context: unknown) =>
				await sandbox.call(
					"executeTool",
					{
						pluginId: descriptor.pluginId,
						contributionId: td.id,
						input,
						context,
					},
					{ timeoutMs },
				),
		};
		api.registerTool(tool);
	}
}

function registerCommands(
	api: AgentExtensionApi,
	sandbox: SubprocessSandbox,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
): void {
	for (const cd of descriptor.contributions.commands) {
		api.registerCommand({
			name: cd.name,
			description: cd.description,
			handler: async (input: string) =>
				await sandbox.call<string>(
					"executeCommand",
					{
						pluginId: descriptor.pluginId,
						contributionId: cd.id,
						input,
					},
					{ timeoutMs },
				),
		});
	}
}

function registerSimpleContributions(
	api: AgentExtensionApi,
	descriptor: SandboxedPluginDescriptor,
): void {
	for (const sd of descriptor.contributions.shortcuts) {
		api.registerShortcut({
			name: sd.name,
			value: sd.value ?? "",
			description: sd.description,
		});
	}

	for (const fd of descriptor.contributions.flags) {
		api.registerFlag({
			name: fd.name,
			description: fd.description,
			defaultValue: fd.defaultValue,
		});
	}

	for (const rd of descriptor.contributions.messageRenderers) {
		api.registerMessageRenderer({
			name: rd.name,
			render: () => `[sandbox renderer ${rd.name} requires async bridge]`,
		});
	}

	for (const pd of descriptor.contributions.providers) {
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
): (payload: unknown) => Promise<unknown> {
	return async (payload: unknown) =>
		await sandbox.call(
			"invokeHook",
			{ pluginId, hookName, payload },
			{ timeoutMs },
		);
}

function bindHooks(
	extension: AgentExtension,
	sandbox: SubprocessSandbox,
	pluginId: string,
	hookTimeoutMs: number,
): void {
	for (const { stage, extensionKey, sandboxHookName } of HOOK_BINDINGS) {
		if (hasHookStage(extension, stage)) {
			const handler = makeHookHandler(
				sandbox,
				pluginId,
				sandboxHookName,
				hookTimeoutMs,
			);
			// Each hook property on AgentExtension accepts (payload: unknown) => Promise<unknown>.
			// TypeScript cannot narrow a union of optional callback keys via computed access,
			// so we use Object.assign to set the property safely.
			Object.assign(extension, { [extensionKey]: handler });
		}
	}
}
