/**
 * Bootstrap script for the plugin sandbox subprocess.
 *
 * This file runs inside an isolated Node.js child process spawned by
 * {@link SubprocessSandbox}. It receives RPC calls over IPC and dynamically
 * imports plugin modules, wiring up their contributions (tools, commands,
 * shortcuts, flags, renderers, providers) and lifecycle hooks.
 *
 * Because it executes in a separate process it must stay bundle-safe and only
 * depend on local helpers that can be inlined into the sandbox build.
 */

import { importPluginModule } from "./plugin-module-import";

// ---------------------------------------------------------------------------
// Types (intentionally minimal – mirrors only what the RPC protocol needs)
// ---------------------------------------------------------------------------

interface PluginTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	execute: (input: unknown, context: unknown) => Promise<unknown>;
}

interface PluginCommand {
	name: string;
	description?: string;
	handler?: (input: string) => Promise<string>;
}

interface PluginShortcut {
	name: string;
	value: string;
	description?: string;
}

interface PluginFlag {
	name: string;
	description?: string;
	defaultValue?: boolean | string | number;
}

interface PluginMessageRenderer {
	name: string;
	render: (message: unknown) => string;
}

interface PluginProvider {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

interface PluginApi {
	registerTool(tool: PluginTool): void;
	registerCommand(command: PluginCommand): void;
	registerShortcut(shortcut: PluginShortcut): void;
	registerFlag(flag: PluginFlag): void;
	registerMessageRenderer(renderer: PluginMessageRenderer): void;
	registerProvider(provider: PluginProvider): void;
}

interface PluginModule {
	name: string;
	manifest: Record<string, unknown>;
	setup?: (api: PluginApi) => void | Promise<void>;
	[hookName: string]: unknown;
}

interface ContributionDescriptor {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	value?: string;
	defaultValue?: boolean | string | number;
	metadata?: Record<string, unknown>;
}

interface PluginDescriptor {
	pluginId: string;
	name: string;
	manifest: Record<string, unknown>;
	contributions: {
		tools: ContributionDescriptor[];
		commands: ContributionDescriptor[];
		shortcuts: ContributionDescriptor[];
		flags: ContributionDescriptor[];
		messageRenderers: ContributionDescriptor[];
		providers: ContributionDescriptor[];
	};
}

interface PluginState {
	plugin: PluginModule;
	handlers: {
		tools: Map<string, PluginTool["execute"]>;
		commands: Map<string, NonNullable<PluginCommand["handler"]>>;
		messageRenderers: Map<string, PluginMessageRenderer["render"]>;
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function assertValidPluginModule(
	plugin: unknown,
	pluginPath: string,
): asserts plugin is PluginModule {
	if (!isObject(plugin)) {
		throw new Error(`Invalid plugin module: ${pluginPath}`);
	}
	if (typeof plugin.name !== "string" || !plugin.name) {
		throw new Error(`Invalid plugin name: ${pluginPath}`);
	}
	if (!isObject(plugin.manifest)) {
		throw new Error(`Invalid plugin manifest: ${pluginPath}`);
	}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pluginCounter = 0;
const pluginState = new Map<string, PluginState>();

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

function toErrorPayload(error: unknown): { message: string; stack?: string } {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;
	return { message, stack };
}

function sendResponse(
	id: string,
	ok: boolean,
	result: unknown,
	error?: { message: string; stack?: string },
): void {
	if (!process.send) return;
	process.send({ type: "response", id, ok, result, error });
}

function emitEvent(name: string, payload?: unknown): void {
	if (!process.send) return;
	process.send({ type: "event", name, payload });
}

// Expose event emitter to plugins.
(globalThis as Record<string, unknown>).__clinePluginHost = { emitEvent };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return value as Record<string, unknown>;
}

function makeId(pluginId: string, prefix: string): string {
	return `${pluginId}_${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPlugin(pluginId: string): PluginState {
	const state = pluginState.get(pluginId);
	if (!state) {
		throw new Error(`Unknown sandbox plugin id: ${pluginId}`);
	}
	return state;
}

// ---------------------------------------------------------------------------
// RPC methods
// ---------------------------------------------------------------------------

async function initialize(args: {
	pluginPaths?: string[];
	exportName?: string;
}): Promise<PluginDescriptor[]> {
	const descriptors: PluginDescriptor[] = [];
	const exportName = args.exportName || "plugin";

	for (const pluginPath of args.pluginPaths || []) {
		const moduleExports = await importPluginModule(pluginPath);
		const plugin = (moduleExports.default ??
			moduleExports[exportName]) as unknown;
		assertValidPluginModule(plugin, pluginPath);

		const pluginId = `plugin_${++pluginCounter}`;
		const contributions: PluginDescriptor["contributions"] = {
			tools: [],
			commands: [],
			shortcuts: [],
			flags: [],
			messageRenderers: [],
			providers: [],
		};
		const handlers: PluginState["handlers"] = {
			tools: new Map(),
			commands: new Map(),
			messageRenderers: new Map(),
		};

		const api: PluginApi = {
			registerTool: (tool) => {
				const id = makeId(pluginId, "tool");
				handlers.tools.set(id, tool.execute);
				contributions.tools.push({
					id,
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					timeoutMs: tool.timeoutMs,
					retryable: tool.retryable,
				});
			},
			registerCommand: (command) => {
				const id = makeId(pluginId, "command");
				if (typeof command.handler === "function") {
					handlers.commands.set(id, command.handler);
				}
				contributions.commands.push({
					id,
					name: command.name,
					description: command.description,
				});
			},
			registerShortcut: (shortcut) => {
				contributions.shortcuts.push({
					id: makeId(pluginId, "shortcut"),
					name: shortcut.name,
					value: shortcut.value,
					description: shortcut.description,
				});
			},
			registerFlag: (flag) => {
				contributions.flags.push({
					id: makeId(pluginId, "flag"),
					name: flag.name,
					description: flag.description,
					defaultValue: flag.defaultValue,
				});
			},
			registerMessageRenderer: (renderer) => {
				const id = makeId(pluginId, "renderer");
				handlers.messageRenderers.set(id, renderer.render);
				contributions.messageRenderers.push({ id, name: renderer.name });
			},
			registerProvider: (provider) => {
				contributions.providers.push({
					id: makeId(pluginId, "provider"),
					name: provider.name,
					description: provider.description,
					metadata: sanitizeObject(provider.metadata),
				});
			},
		};

		if (typeof plugin.setup === "function") {
			await plugin.setup(api);
		}

		pluginState.set(pluginId, { plugin, handlers });
		descriptors.push({
			pluginId,
			name: plugin.name,
			manifest: plugin.manifest,
			contributions,
		});
	}

	return descriptors;
}

async function invokeHook(args: {
	pluginId: string;
	hookName: string;
	payload: unknown;
}): Promise<unknown> {
	const state = getPlugin(args.pluginId);
	const handler = state.plugin[args.hookName];
	if (typeof handler !== "function") {
		return undefined;
	}
	return await (handler as (payload: unknown) => Promise<unknown>)(
		args.payload,
	);
}

async function executeTool(args: {
	pluginId: string;
	contributionId: string;
	input: unknown;
	context: unknown;
}): Promise<unknown> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.tools.get(args.contributionId);
	if (typeof handler !== "function") {
		throw new Error("Unknown sandbox tool contribution");
	}
	return await handler(args.input, args.context);
}

async function executeCommand(args: {
	pluginId: string;
	contributionId: string;
	input: string;
}): Promise<string> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.commands.get(args.contributionId);
	if (typeof handler !== "function") {
		return "";
	}
	return await handler(args.input);
}

async function renderMessage(args: {
	pluginId: string;
	contributionId: string;
	message: unknown;
}): Promise<string> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.messageRenderers.get(args.contributionId);
	if (typeof handler !== "function") {
		return "";
	}
	return await handler(args.message);
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

const methods: Record<string, (args: never) => Promise<unknown>> = {
	initialize,
	invokeHook,
	executeTool,
	executeCommand,
	renderMessage,
};

process.on(
	"message",
	async (message: {
		type: string;
		id: string;
		method: string;
		args?: unknown;
	}) => {
		if (!message || message.type !== "call") {
			return;
		}
		const method = methods[message.method];
		if (!method) {
			sendResponse(message.id, false, undefined, {
				message: `Unknown method: ${String(message.method)}`,
			});
			return;
		}
		try {
			const result = await method((message.args || {}) as never);
			sendResponse(message.id, true, result);
		} catch (error) {
			sendResponse(message.id, false, undefined, toErrorPayload(error));
		}
	},
);
