/**
 * Bootstrap script for the plugin sandbox.
 *
 * This file runs either inside an isolated child process spawned by
 * {@link SubprocessSandbox} or inside a worker thread started by
 * {@link WorkerSandbox}. It receives RPC calls over IPC (or the worker's
 * message port) and dynamically
 * imports plugin modules, wiring up their contributions (tools, commands,
 * message builders, providers) and lifecycle hooks.
 *
 * Because it executes in a separate process it must stay bundle-safe and only
 * depend on local helpers that can be inlined into the sandbox build.
 */

import { isMainThread, parentPort } from "node:worker_threads";
import {
	type AgentExtensionMcpServer,
	type AutomationEventEnvelope,
	normalizePluginManifest,
	type PluginManifest,
} from "@cline/shared";
import { installParentDisconnectGuard } from "../../runtime/tools/subprocess-sandbox-lifecycle";
import { importPluginModule } from "./plugin-module-import";
import {
	matchesPluginManifestTargeting,
	type PluginTargeting,
} from "./plugin-targeting";

// The executable has already selected its runtime mode. Do not make commands
// launched by plugins inherit Bun-only mode instead of their CLI entrypoint.
if (isMainThread) delete process.env.BUN_BE_BUN;

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
	/** Other definition fields (lifecycle, executionMode, ...) pass through. */
	[field: string]: unknown;
}

interface PluginCommand {
	name: string;
	description?: string;
	handler?: (
		input: string,
	) => Promise<PluginCommandResult> | PluginCommandResult;
}

// Keep this local mirror in sync with AgentExtensionCommandResult from @cline/shared.
// The sandbox bootstrap runs in an isolated process and avoids host package imports.
type PluginCommandResult =
	| string
	| {
			reply?: string;
			submitPrompt?: string;
	  };

interface PluginRule {
	id: string;
	content: string | (() => string | Promise<string>);
	source?: string;
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

interface PluginAutomationEventType {
	eventType: string;
	source: string;
	description?: string;
	attributesSchema?: Record<string, unknown>;
	payloadSchema?: Record<string, unknown>;
	examples?: AutomationEventEnvelope[];
	metadata?: Record<string, unknown>;
}

interface PluginApi {
	registerTool(tool: PluginTool): void;
	registerCommand(command: PluginCommand): void;
	registerRule(rule: PluginRule): void;
	registerMessageBuilder(builder: PluginMessageBuilder): void;
	registerProvider(provider: PluginProvider): void;
	registerAutomationEventType(eventType: PluginAutomationEventType): void;
	registerMcpServer(server: AgentExtensionMcpServer): void;
}

interface PluginSetupCtx {
	session?: unknown;
	client?: unknown;
	user?: unknown;
	workspaceInfo?: unknown;
	cwd?: string;
	emitEvent?: (name: string, payload?: unknown) => void;
	onDispose?: (cleanup: () => void | Promise<void>) => void;
	automation?: {
		ingestEvent(event: AutomationEventEnvelope): void | Promise<void>;
	};
	logger?: {
		debug(message: string, metadata?: Record<string, unknown>): void;
		log(message: string, metadata?: Record<string, unknown>): void;
		error(message: string, metadata?: Record<string, unknown>): void;
	};
	telemetry?: PluginTelemetryBridge;
}

/**
 * Sandbox-side telemetry proxy, shaped like the host's ITelemetryService.
 * Live telemetry clients cannot cross the JSON IPC boundary, so capture and
 * record calls are forwarded to the host as `plugin_telemetry` events and
 * routed into the host telemetry service there. Identity and common-property
 * setters are host concerns and are intentionally no-ops in the sandbox.
 */
interface PluginTelemetryBridge {
	capture(input: { event: string; properties?: Record<string, unknown> }): void;
	captureRequired(event: string, properties?: Record<string, unknown>): void;
	recordCounter(
		name: string,
		value: number,
		attributes?: Record<string, unknown>,
		description?: string,
		required?: boolean,
	): void;
	recordHistogram(
		name: string,
		value: number,
		attributes?: Record<string, unknown>,
		description?: string,
		required?: boolean,
	): void;
	recordGauge(
		name: string,
		value: number,
		attributes?: Record<string, unknown>,
		description?: string,
		required?: boolean,
	): void;
	isEnabled(): boolean;
	setDistinctId(distinctId?: string): void;
	setMetadata(metadata: Record<string, unknown>): void;
	updateMetadata(metadata: Record<string, unknown>): void;
	setCommonProperties(properties: Record<string, unknown>): void;
	updateCommonProperties(properties: Record<string, unknown>): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

interface PluginModule {
	name: string;
	manifest: PluginManifest;
	setup?: (api: PluginApi, ctx: PluginSetupCtx) => void | Promise<void>;
	hooks?: Record<string, (ctx: unknown) => unknown | Promise<unknown>>;
}

interface ContributionDescriptor {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	/** Tools: the rest of the tool definition, without functions. */
	definition?: Record<string, unknown>;
	value?: string;
	defaultValue?: boolean | string | number;
	metadata?: Record<string, unknown>;
}

interface RuleContributionDescriptor {
	id: string;
	ruleId: string;
	content?: string;
	source?: string;
	hasContentHandler?: boolean;
}

interface AutomationEventTypeDescriptor {
	id: string;
	eventType: string;
	source: string;
	description?: string;
	attributesSchema?: Record<string, unknown>;
	payloadSchema?: Record<string, unknown>;
	examples?: AutomationEventEnvelope[];
	metadata?: Record<string, unknown>;
}

interface PluginDescriptor {
	pluginId: string;
	pluginPath: string;
	name: string;
	manifest: PluginManifest;
	hooks?: string[];
	contributions: {
		tools: ContributionDescriptor[];
		commands: ContributionDescriptor[];
		rules: RuleContributionDescriptor[];
		messageBuilders: ContributionDescriptor[];
		providers: ContributionDescriptor[];
		automationEventTypes: AutomationEventTypeDescriptor[];
		mcpServers: AgentExtensionMcpServer[];
		shortcuts?: ContributionDescriptor[];
		flags?: ContributionDescriptor[];
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
	/** Plugins the session policy turned off once their own name was known. */
	disabledByPolicy: Array<{ pluginPath: string; name: string }>;
}

/**
 * The session plugin policy, shaped like `toolPolicies` (`"*"` default plus
 * per-plugin overrides). Mirrors `isPluginEnabledByPolicy` in the registry.
 */
type PluginPolicy = Record<string, { enabled?: boolean } | undefined>;

function isEnabledByPolicy(
	policy: PluginPolicy | undefined,
	names: ReadonlyArray<string>,
): boolean {
	if (!policy) return true;
	for (const name of names) {
		const enabled = policy[name]?.enabled;
		if (typeof enabled === "boolean") return enabled;
	}
	return policy["*"]?.enabled ?? true;
}

interface PluginState {
	plugin: PluginModule;
	/** Cleanup registered through `ctx.onDispose`, run by `dispose`. */
	disposers: Array<() => void | Promise<void>>;
	handlers: {
		tools: Map<string, PluginTool["execute"]>;
		commands: Map<string, NonNullable<PluginCommand["handler"]>>;
		rules: Map<string, () => string | Promise<string>>;
		messageBuilders: Map<string, PluginMessageBuilder["build"]>;
	};
}

type LoadedPluginResult =
	| {
			type: "loaded";
			descriptor: PluginDescriptor;
			state: PluginState;
	  }
	| {
			type: "skipped";
	  }
	| {
			type: "policy_disabled";
			name: string;
	  }
	| {
			type: "failure";
			failure: PluginInitializationFailure;
	  };

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

function assertValidPluginSetupCtx(
	ctx: unknown,
): asserts ctx is PluginSetupCtx {
	if (!isObject(ctx)) {
		throw new Error("Plugin setup context must be an object");
	}
	if (ctx.session !== undefined && !isObject(ctx.session)) {
		throw new Error("Plugin setup context session must be an object");
	}
	if (ctx.client !== undefined && !isObject(ctx.client)) {
		throw new Error("Plugin setup context client must be an object");
	}
	if (ctx.user !== undefined && !isObject(ctx.user)) {
		throw new Error("Plugin setup context user must be an object");
	}
	if (ctx.workspaceInfo !== undefined && !isObject(ctx.workspaceInfo)) {
		throw new Error("Plugin setup context workspaceInfo must be an object");
	}
	if (ctx.automation !== undefined && !isObject(ctx.automation)) {
		throw new Error("Plugin setup context automation must be an object");
	}
	if (
		ctx.automation !== undefined &&
		typeof ctx.automation.ingestEvent !== "function"
	) {
		throw new Error(
			"Plugin setup context automation.ingestEvent must be a function",
		);
	}
	if (ctx.logger !== undefined && !isObject(ctx.logger)) {
		throw new Error("Plugin setup context logger must be an object");
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

/**
 * The host link: the worker's message port when running as a worker thread,
 * otherwise the child process IPC channel.
 */
const port = isMainThread ? undefined : parentPort;

if (port) {
	// Plugin stdout must never reach the host's stdout, which may carry
	// `--json` output or a JSON-RPC stream. The subprocess sandbox discards
	// it (stdio "ignore"), and Node workers pipe it to the host, but Bun
	// workers write straight to the host's stdout. Discard it here too.
	const discard = () => {};
	console.log = discard;
	console.info = discard;
	console.debug = discard;
	console.dir = discard;
	console.table = discard;
	// write(chunk, cb) and write(chunk, encoding, cb): still complete the
	// callback, asynchronously as a real stream does, so a plugin awaiting
	// its write does not hang.
	process.stdout.write = ((_chunk: unknown, ...rest: unknown[]) => {
		const callback = rest.find((arg) => typeof arg === "function") as
			| ((error?: Error | null) => void)
			| undefined;
		if (callback) process.nextTick(callback);
		return true;
	}) as typeof process.stdout.write;
}

function isDataCloneError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "DataCloneError" ||
			/could not be cloned/i.test(error.message))
	);
}

function postToHost(message: Record<string, unknown>): void {
	if (port) {
		try {
			port.postMessage(message);
		} catch (error) {
			if (!isDataCloneError(error)) throw error;
			// Structured clone rejects functions that JSON IPC silently drops.
			// Match the subprocess behavior so plugins act the same in both.
			port.postMessage(JSON.parse(JSON.stringify(message)));
		}
		return;
	}
	process.send?.(message);
}

function sendResponse(
	id: string,
	ok: boolean,
	result: unknown,
	error?: { message: string; stack?: string },
): void {
	postToHost({ type: "response", id, ok, result, error });
}

function emitEvent(name: string, payload?: unknown): void {
	postToHost({ type: "event", name, payload });
}

/**
 * Internal events (never forwarded to the session): progress updates for a
 * tool call, and the end of a plugin's import so the host can tell an import
 * failure from a setup failure. Keep in sync with plugin-sandbox.ts.
 */
const TOOL_UPDATE_EVENT = "__cline_tool_update";
const SETUP_STARTED_EVENT = "__cline_setup_started";

/** A tool's definition fields as plain data (functions dropped). */
function toolDefinitionData(tool: PluginTool): Record<string, unknown> {
	const definition: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tool)) {
		if (key === "execute" || typeof value === "function") continue;
		definition[key] = value;
	}
	return JSON.parse(JSON.stringify(definition)) as Record<string, unknown>;
}

function withTimeout<T>(
	fn: () => T | Promise<T>,
	timeoutMs: number | undefined,
	label: string,
): Promise<T> {
	if (!timeoutMs || timeoutMs <= 0) return Promise.resolve().then(fn);
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
		Promise.resolve()
			.then(fn)
			.then(resolve, reject)
			.finally(() => clearTimeout(timer));
	});
}

// Expose event emitter to plugins.
(globalThis as Record<string, unknown>).__clinePluginHost = { emitEvent };

/**
 * Session workspace env — populated by `initialize()` and available to any
 * plugin code that executes before the setup hook, or cannot use hook context.
 * Prefer using PluginSetupCtx from the setup function when possible.
 */
(globalThis as Record<string, unknown>).__clineSessionEnv = {
	cwd: undefined as string | undefined,
	workspaceInfo: undefined as unknown,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return value as Record<string, unknown>;
}

function sanitizeLogMetadata(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const metadata = { ...(value as Record<string, unknown>) };
	if (metadata.error instanceof Error) {
		metadata.error = {
			name: metadata.error.name,
			message: metadata.error.message,
			stack: metadata.error.stack,
		};
	}
	return metadata;
}

function createPluginLogger(
	pluginName: string,
): NonNullable<PluginSetupCtx["logger"]> {
	const emitLog = (
		level: "debug" | "log" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	) => {
		emitEvent("plugin_log", {
			level,
			pluginName,
			message,
			metadata: sanitizeLogMetadata(metadata),
		});
	};
	return {
		debug: (message, metadata) => emitLog("debug", message, metadata),
		log: (message, metadata) => emitLog("log", message, metadata),
		error: (message, metadata) => emitLog("error", message, metadata),
	};
}

function createPluginTelemetry(pluginName: string): PluginTelemetryBridge {
	const emit = (payload: Record<string, unknown>) => {
		emitEvent("plugin_telemetry", { pluginName, ...payload });
	};
	const record =
		(metric: "counter" | "histogram" | "gauge") =>
		(
			name: string,
			value: number,
			attributes?: Record<string, unknown>,
			description?: string,
			required?: boolean,
		) => {
			emit({
				kind: "metric",
				metric,
				name,
				value,
				attributes: sanitizeLogMetadata(attributes),
				description,
				required,
			});
		};
	const noop = () => {
		// Identity and common properties are managed by the host telemetry
		// service; sandboxed plugins cannot change them.
	};
	return {
		capture: (input) => {
			emit({
				kind: "event",
				event: input?.event,
				properties: sanitizeLogMetadata(input?.properties),
			});
		},
		captureRequired: (event, properties) => {
			emit({
				kind: "event",
				event,
				properties: sanitizeLogMetadata(properties),
				required: true,
			});
		},
		recordCounter: record("counter"),
		recordHistogram: record("histogram"),
		recordGauge: record("gauge"),
		// The bridge is stateless: the host is the arbiter of whether
		// telemetry is enabled and drops forwarded events when the user has
		// opted out. Reporting true keeps plugins emitting unconditionally —
		// which also means isEnabled() cannot be used to skip expensive
		// property computation in sandboxed plugins; keep properties cheap.
		isEnabled: () => true,
		setDistinctId: noop,
		setMetadata: noop,
		updateMetadata: noop,
		setCommonProperties: noop,
		updateCommonProperties: noop,
		flush: async () => {},
		dispose: async () => {},
	};
}

function makeId(pluginId: string, prefix: string): string {
	const key = `${pluginId}:${prefix}`;
	const next = (contributionCounters.get(key) ?? 0) + 1;
	contributionCounters.set(key, next);
	return `${pluginId}_${prefix}_${next}`;
}

function normalizeAutomationEventType(
	eventType: PluginAutomationEventType,
): PluginAutomationEventType {
	const normalizedEventType =
		typeof eventType.eventType === "string" ? eventType.eventType.trim() : "";
	const source =
		typeof eventType.source === "string" ? eventType.source.trim() : "";
	if (!normalizedEventType) {
		throw new Error("Automation event type contribution requires eventType");
	}
	if (!source) {
		throw new Error("Automation event type contribution requires source");
	}
	return {
		...eventType,
		eventType: normalizedEventType,
		source,
		examples: eventType.examples ? [...eventType.examples] : undefined,
		metadata: eventType.metadata
			? sanitizeObject(eventType.metadata)
			: undefined,
	};
}

function getPlugin(pluginId: string): PluginState {
	const state = pluginState.get(pluginId);
	if (!state) {
		throw new Error(`Unknown sandbox plugin id: ${pluginId}`);
	}
	return state;
}

async function loadPluginDescriptor(args: {
	pluginPath: string;
	pluginId: string;
	exportName: string;
	targeting: PluginTargeting;
	setupCtxBase: Pick<
		PluginSetupCtx,
		"session" | "client" | "user" | "workspaceInfo" | "cwd"
	>;
	setupTimeoutMs?: number;
	loggerEnabled?: boolean;
	telemetryEnabled?: boolean;
	policy?: PluginPolicy;
	/** Names the policy may use besides the plugin's own (its file name). */
	policyNames?: string[];
}): Promise<LoadedPluginResult> {
	let plugin: PluginModule | undefined;
	const disposers: PluginState["disposers"] = [];
	try {
		const moduleExports = await importPluginModule(args.pluginPath);
		plugin = (moduleExports.default ??
			moduleExports[args.exportName]) as unknown as PluginModule;
		assertValidPluginModule(plugin, args.pluginPath);
		plugin.manifest = normalizePluginManifest(plugin.manifest);
		if (!matchesPluginManifestTargeting(plugin.manifest, args.targeting)) {
			return { type: "skipped" };
		}
		// The plugin's own name is only known after import; decide before
		// setup() runs so a plugin the session turned off has no side effects.
		if (
			!isEnabledByPolicy(args.policy, [
				plugin.name,
				...(args.policyNames ?? []),
			])
		) {
			return { type: "policy_disabled", name: plugin.name };
		}

		const contributions: PluginDescriptor["contributions"] = {
			tools: [],
			commands: [],
			rules: [],
			messageBuilders: [],
			providers: [],
			automationEventTypes: [],
			mcpServers: [],
			shortcuts: [],
			flags: [],
		};
		const handlers: PluginState["handlers"] = {
			tools: new Map(),
			commands: new Map(),
			rules: new Map(),
			messageBuilders: new Map(),
		};

		const api: PluginApi = {
			registerTool: (tool) => {
				const id = makeId(args.pluginId, "tool");
				handlers.tools.set(id, tool.execute);
				contributions.tools.push({
					id,
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					timeoutMs: tool.timeoutMs,
					retryable: tool.retryable,
					definition: toolDefinitionData(tool),
				});
			},
			registerCommand: (command) => {
				const id = makeId(args.pluginId, "command");
				if (typeof command.handler === "function") {
					handlers.commands.set(id, command.handler);
				}
				contributions.commands.push({
					id,
					name: command.name,
					description: command.description,
				});
			},
			registerRule: (rule) => {
				const id = makeId(args.pluginId, "rule");
				if (typeof rule.content === "function") {
					handlers.rules.set(id, rule.content);
					contributions.rules.push({
						id,
						ruleId: rule.id,
						source: rule.source,
						hasContentHandler: true,
					});
					return;
				}
				contributions.rules.push({
					id,
					ruleId: rule.id,
					content: rule.content,
					source: rule.source,
				});
			},
			registerMessageBuilder: (builder) => {
				const id = makeId(args.pluginId, "builder");
				handlers.messageBuilders.set(id, builder.build);
				contributions.messageBuilders.push({ id, name: builder.name });
			},
			registerProvider: (provider) => {
				contributions.providers.push({
					id: makeId(args.pluginId, "provider"),
					name: provider.name,
					description: provider.description,
					metadata: sanitizeObject(provider.metadata),
				});
			},
			registerAutomationEventType: (eventType) => {
				contributions.automationEventTypes.push({
					id: makeId(args.pluginId, "automation_event"),
					...normalizeAutomationEventType(eventType),
				});
			},
			registerMcpServer: (server) => {
				contributions.mcpServers.push(server);
			},
		};

		if (typeof plugin.setup === "function") {
			// Tell the host the import finished, so a setup that hangs or
			// crashes the sandbox is reported as setup, not import.
			emitEvent(SETUP_STARTED_EVENT, { pluginPath: args.pluginPath });
			try {
				const setupCtx = {
					...args.setupCtxBase,
					emitEvent,
					onDispose: (cleanup: () => void | Promise<void>) => {
						if (typeof cleanup === "function") disposers.push(cleanup);
					},
					// Only offered when the host actually has a telemetry service:
					// the feature-detection contract (`ctx.telemetry?.capture`) must
					// mean "someone is listening".
					...(args.telemetryEnabled
						? { telemetry: createPluginTelemetry(plugin.name) }
						: {}),
					...(args.loggerEnabled
						? { logger: createPluginLogger(plugin.name) }
						: {}),
					...(plugin.manifest.capabilities.includes("automationEvents")
						? {
								automation: {
									ingestEvent: (event: AutomationEventEnvelope) => {
										emitEvent("automation_event", event);
									},
								},
							}
						: {}),
				};
				assertValidPluginSetupCtx(setupCtx);
				const setup = plugin.setup.bind(plugin);
				await withTimeout(
					() => setup(api, setupCtx),
					args.setupTimeoutMs,
					`Plugin "${plugin.name}" setup`,
				);
			} catch (error) {
				// The plugin is dropped, so nothing would run its cleanup later.
				// Run it now: a child process started before the failure would
				// otherwise outlive the worker.
				await withTimeout(
					() => runDisposers(plugin?.name ?? args.pluginPath, disposers),
					args.setupTimeoutMs ?? DISPOSE_AFTER_FAILED_SETUP_TIMEOUT_MS,
					`Plugin "${plugin.name}" cleanup after failed setup`,
				).catch(() => {
					// Best effort; the failure below is what gets reported.
				});
				return {
					type: "failure",
					failure: {
						pluginPath: args.pluginPath,
						pluginName: plugin.name,
						phase: "setup",
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				};
			}
		}

		return {
			type: "loaded",
			state: { plugin, handlers, disposers },
			descriptor: {
				pluginId: args.pluginId,
				pluginPath: args.pluginPath,
				name: plugin.name,
				manifest: plugin.manifest,
				hooks: plugin.hooks
					? Object.entries(plugin.hooks)
							.filter(([, hook]) => typeof hook === "function")
							.map(([name]) => name)
					: undefined,
				contributions,
			},
		};
	} catch (error) {
		return {
			type: "failure",
			failure: {
				pluginPath: args.pluginPath,
				pluginName: plugin?.name,
				phase: "load",
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		};
	}
}

// ---------------------------------------------------------------------------
// RPC methods
// ---------------------------------------------------------------------------

async function initialize(args: {
	pluginPaths?: string[];
	exportName?: string;
	providerId?: string;
	modelId?: string;
	cwd?: string;
	session?: unknown;
	client?: unknown;
	user?: unknown;
	workspaceInfo?: unknown;
	loggerEnabled?: boolean;
	telemetryEnabled?: boolean;
	setupTimeoutMs?: number;
	policy?: PluginPolicy;
	policyNames?: Record<string, string[]>;
}): Promise<InitializeResult> {
	pluginState.clear();
	pluginCounter = 0;
	contributionCounters.clear();

	// Apply the session's working directory so that process.cwd() and relative
	// path resolution inside plugins reflect the correct workspace, not the
	// host process's cwd (which may differ when --cwd was used without calling
	// process.chdir() on the host side).
	// A worker must not chdir: Node throws, and Bun changes the cwd of the
	// whole host process. Overriding process.cwd() is local to the worker, so
	// plugins still see the session's directory. Relative fs paths keep
	// resolving against the host cwd.
	if (args.cwd && port) {
		const cwd = args.cwd;
		process.cwd = () => cwd;
	} else if (args.cwd) {
		try {
			process.chdir(args.cwd);
		} catch {
			// Ignore — best-effort; path may not exist in unusual environments.
		}
	}

	// Keep the global escape-hatch in sync with the active session.
	const sessionEnv = (globalThis as Record<string, unknown>)
		.__clineSessionEnv as Record<string, unknown>;
	if (sessionEnv) {
		sessionEnv.cwd = args.cwd;
		sessionEnv.workspaceInfo = args.workspaceInfo;
	}

	const descriptors: PluginDescriptor[] = [];
	const failures: PluginInitializationFailure[] = [];
	const warnings: PluginInitializationWarning[] = [];
	const disabledByPolicy: InitializeResult["disabledByPolicy"] = [];
	const exportName = args.exportName || "plugin";
	const pluginIndexByName = new Map<string, number>();
	const targeting: PluginTargeting = {
		providerId: args.providerId,
		modelId: args.modelId,
	};
	const setupCtxBase = {
		session: args.session,
		client: args.client,
		user: args.user,
		workspaceInfo: args.workspaceInfo,
		cwd: args.cwd,
	};

	const loadResults = await Promise.all(
		(args.pluginPaths || []).map((pluginPath) => {
			const pluginId = `plugin_${++pluginCounter}`;
			return loadPluginDescriptor({
				pluginPath,
				pluginId,
				exportName,
				targeting,
				setupCtxBase,
				setupTimeoutMs: args.setupTimeoutMs,
				policy: args.policy,
				policyNames: args.policyNames?.[pluginPath],
				loggerEnabled: args.loggerEnabled,
				telemetryEnabled: args.telemetryEnabled,
			});
		}),
	);

	for (const [index, result] of loadResults.entries()) {
		if (result.type === "skipped") {
			continue;
		}
		if (result.type === "policy_disabled") {
			disabledByPolicy.push({
				pluginPath: args.pluginPaths?.[index] ?? "",
				name: result.name,
			});
			continue;
		}
		if (result.type === "failure") {
			failures.push(result.failure);
			continue;
		}

		const { descriptor, state } = result;
		const previousIndex = pluginIndexByName.get(descriptor.name);
		if (previousIndex !== undefined) {
			const previous = descriptors[previousIndex];
			if (!previous) {
				pluginIndexByName.delete(descriptor.name);
			} else {
				warnings.push({
					type: "duplicate_plugin_override",
					pluginName: descriptor.name,
					pluginPath: descriptor.pluginPath,
					overriddenPluginPath: previous.pluginPath,
					message: `Plugin "${descriptor.name}" from ${descriptor.pluginPath} overrides ${previous.pluginPath}`,
				});
				pluginState.delete(previous.pluginId);
				descriptors.splice(previousIndex, 1);
				pluginIndexByName.clear();
				for (const [index, descriptor] of descriptors.entries()) {
					pluginIndexByName.set(descriptor.name, index);
				}
			}
		}

		pluginState.set(descriptor.pluginId, state);
		pluginIndexByName.set(descriptor.name, descriptors.length);
		descriptors.push(descriptor);
	}

	return { plugins: descriptors, failures, warnings, disabledByPolicy };
}

async function invokeHook(args: {
	pluginId: string;
	hookName: string;
	payload: unknown;
}): Promise<unknown> {
	const state = getPlugin(args.pluginId);
	const handler = state.plugin.hooks?.[args.hookName];
	if (typeof handler !== "function") {
		return undefined;
	}
	return await (handler as (payload: unknown) => Promise<unknown>)(
		args.payload,
	);
}

/** Abort controllers for tool calls in flight, by host call id. */
const toolCallControllers = new Map<string, AbortController>();

async function executeTool(args: {
	pluginId: string;
	contributionId: string;
	input: unknown;
	context: unknown;
	callId?: string;
	aborted?: boolean;
}): Promise<unknown> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.tools.get(args.contributionId);
	if (typeof handler !== "function") {
		throw new Error("Unknown sandbox tool contribution");
	}
	// Rebuild the live parts of the tool context the host could not send:
	// an abort signal the host drives through `abortToolCall`, progress
	// updates, and session events.
	const callId = args.callId;
	const controller = new AbortController();
	if (args.aborted) controller.abort();
	if (callId) toolCallControllers.set(callId, controller);
	const context = {
		...sanitizeObject(args.context),
		signal: controller.signal,
		emitEvent,
		emitUpdate: (update: unknown) => {
			if (callId) emitEvent(TOOL_UPDATE_EVENT, { callId, update });
		},
	};
	try {
		return await handler(args.input, context);
	} finally {
		if (callId) toolCallControllers.delete(callId);
	}
}

async function abortToolCall(args: {
	callId: string;
	reason?: string;
}): Promise<void> {
	toolCallControllers
		.get(args.callId)
		?.abort(args.reason ? new Error(args.reason) : undefined);
}

/** Runs every plugin's `ctx.onDispose` cleanup, newest first. */
async function dispose(): Promise<void> {
	for (const state of pluginState.values()) {
		await runDisposers(state.plugin.name, state.disposers);
	}
}

const DISPOSE_AFTER_FAILED_SETUP_TIMEOUT_MS = 3_000;

/** Runs (and clears) `ctx.onDispose` cleanup, newest first. */
async function runDisposers(
	pluginName: string,
	disposers: PluginState["disposers"],
): Promise<void> {
	for (const cleanup of disposers.splice(0).reverse()) {
		try {
			await cleanup();
		} catch (error) {
			emitEvent("plugin_log", {
				level: "error",
				pluginName,
				message: `onDispose cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
}

async function executeCommand(args: {
	pluginId: string;
	contributionId: string;
	input: string;
}): Promise<PluginCommandResult> {
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

async function resolveRuleContent(args: {
	pluginId: string;
	contributionId: string;
}): Promise<string> {
	const state = getPlugin(args.pluginId);
	const handler = state.handlers.rules.get(args.contributionId);
	if (typeof handler !== "function") {
		return "";
	}
	return await handler();
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

const methods: Record<string, (args: never) => Promise<unknown>> = {
	initialize,
	invokeHook,
	executeTool,
	abortToolCall,
	dispose,
	executeCommand,
	buildMessages,
	resolveRuleContent,
};

async function onHostMessage(message: {
	type: string;
	id: string;
	method: string;
	args?: unknown;
}): Promise<void> {
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
}

if (port) {
	// Terminating the worker ends it; there is no IPC channel to watch.
	port.on("message", onHostMessage);
	postToHost({ type: "ready" });
} else {
	installParentDisconnectGuard();
	process.on("message", onHostMessage);
}
