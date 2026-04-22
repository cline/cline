/**
 * Bootstrap script for the plugin sandbox subprocess.
 *
 * This file runs inside an isolated Node.js child process spawned by
 * {@link SubprocessSandbox}. It receives RPC calls over IPC and dynamically
 * imports plugin modules, wiring up their contributions (tools, commands,
 * message builders, providers) and lifecycle hooks.
 *
 * Because it executes in a separate process it must stay bundle-safe and only
 * depend on local helpers that can be inlined into the sandbox build.
 */

import { normalizePluginManifest, type PluginManifest } from "@clinebot/shared";
import { importPluginModule } from "./plugin-module-import";
import {
	matchesPluginManifestTargeting,
	type PluginTargeting,
} from "./plugin-targeting";

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

interface PluginMessageBuilder {
	name: string;
	build: (message: unknown[]) => unknown[]; // Message[]
}

interface PluginProvider {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

interface PluginApi {
	registerTool(tool: PluginTool): void;
	registerCommand(command: PluginCommand): void;
	registerMessageBuilder(builder: PluginMessageBuilder): void;
	registerProvider(provider: PluginProvider): void;
}

interface PluginModule {
	name: string;
	manifest: PluginManifest;
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
	pluginPath: string;
	name: string;
	manifest: PluginManifest;
	contributions: {
		tools: ContributionDescriptor[];
		commands: ContributionDescriptor[];
		messageBuilders: ContributionDescriptor[];
		providers: ContributionDescriptor[];
	};
}

interface PluginInitializationFailure {
	pluginPath: string;
	pluginName?: string;
	phase: "load" | "setup";
	message: string;
	stack?: string;
}

interface PluginInitializationWarning {
	type: "duplicate_plugin_override";
	pluginPath: string;
	pluginName: string;
	overriddenPluginPath: string;
	message: string;
}

interface InitializeResult {
	plugins: PluginDescriptor[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

interface PluginState {
	plugin: PluginModule;
	handlers: {
		tools: Map<string, PluginTool["execute"]>;
		commands: Map<string, NonNullable<PluginCommand["handler"]>>;
		messageBuilders: Map<string, PluginMessageBuilder["build"]>;
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasValidStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
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
	if (
		Object.hasOwn(plugin.manifest, "providerIds") &&
		!hasValidStringArray(plugin.manifest.providerIds)
	) {
		throw new Error(`Invalid plugin manifest.providerIds: ${pluginPath}`);
	}
	if (
		Object.hasOwn(plugin.manifest, "modelIds") &&
		!hasValidStringArray(plugin.manifest.modelIds)
	) {
		throw new Error(`Invalid plugin manifest.modelIds: ${pluginPath}`);
	}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pluginCounter = 0;
const pluginState = new Map<string, PluginState>();
const contributionCounters = new Map<string, number>();

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
	const key = `${pluginId}:${prefix}`;
	const next = (contributionCounters.get(key) ?? 0) + 1;
	contributionCounters.set(key, next);
	return `${pluginId}_${prefix}_${next}`;
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
	providerId?: string;
	modelId?: string;
}): Promise<InitializeResult> {
	pluginState.clear();
	pluginCounter = 0;
	contributionCounters.clear();

	const descriptors: PluginDescriptor[] = [];
	const failures: PluginInitializationFailure[] = [];
	const warnings: PluginInitializationWarning[] = [];
	const exportName = args.exportName || "plugin";
	const pluginIndexByName = new Map<string, number>();
	const targeting: PluginTargeting = {
		providerId: args.providerId,
		modelId: args.modelId,
	};

	for (const pluginPath of args.pluginPaths || []) {
		let plugin: PluginModule | undefined;
		try {
			const moduleExports = await importPluginModule(pluginPath);
			plugin = (moduleExports.default ??
				moduleExports[exportName]) as unknown as PluginModule;
			assertValidPluginModule(plugin, pluginPath);
			plugin.manifest = normalizePluginManifest(plugin.manifest);
			if (!matchesPluginManifestTargeting(plugin.manifest, targeting)) {
				continue;
			}

			const pluginId = `plugin_${++pluginCounter}`;
			const contributions: PluginDescriptor["contributions"] = {
				tools: [],
				commands: [],
				messageBuilders: [],
				providers: [],
			};
			const handlers: PluginState["handlers"] = {
				tools: new Map(),
				commands: new Map(),
				messageBuilders: new Map(),
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
				registerMessageBuilder: (builder) => {
					const id = makeId(pluginId, "builder");
					handlers.messageBuilders.set(id, builder.build);
					contributions.messageBuilders.push({ id, name: builder.name });
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
				try {
					await plugin.setup(api);
				} catch (error) {
					failures.push({
						pluginPath,
						pluginName: plugin.name,
						phase: "setup",
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					});
					continue;
				}
			}

			const previousIndex = pluginIndexByName.get(plugin.name);
			if (previousIndex !== undefined) {
				const previous = descriptors[previousIndex];
				if (!previous) {
					pluginIndexByName.delete(plugin.name);
				} else {
					warnings.push({
						type: "duplicate_plugin_override",
						pluginName: plugin.name,
						pluginPath,
						overriddenPluginPath: previous.pluginPath,
						message: `Plugin "${plugin.name}" from ${pluginPath} overrides ${previous.pluginPath}`,
					});
					pluginState.delete(previous.pluginId);
					descriptors.splice(previousIndex, 1);
					pluginIndexByName.clear();
					for (const [index, descriptor] of descriptors.entries()) {
						pluginIndexByName.set(descriptor.name, index);
					}
				}
			}

			pluginState.set(pluginId, { plugin, handlers });
			pluginIndexByName.set(plugin.name, descriptors.length);
			descriptors.push({
				pluginId,
				pluginPath,
				name: plugin.name,
				manifest: plugin.manifest,
				contributions,
			});
		} catch (error) {
			failures.push({
				pluginPath,
				pluginName: plugin?.name,
				phase: "load",
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}

	return { plugins: descriptors, failures, warnings };
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

async function buildMessages(args: {
	pluginId: string;
	contributionId: string;
	messages: unknown[];
}): Promise<unknown[]> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.messageBuilders.get(args.contributionId);
	if (typeof handler !== "function") {
		return [];
	}
	return await handler(args.messages);
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

const methods: Record<string, (args: never) => Promise<unknown>> = {
	initialize,
	invokeHook,
	executeTool,
	executeCommand,
	buildMessages,
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
