import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentConfig,
	AgentExtensionAutomationEventType,
	AgentExtensionCommandResult,
	AgentExtensionMcpServer,
	AgentExtensionRule,
	AgentRuntimeHooks,
	AgentTool,
	AgentToolContext,
	Message,
	PluginSetupContext,
	WorkspaceInfo,
} from "@cline/shared";
import { SubprocessSandbox } from "../../runtime/tools/subprocess-sandbox";
import { MAX_NODE_TIMER_DELAY_MS } from "../../runtime/tools/subprocess-sandbox-lifecycle";
import { WorkerSandbox } from "../../runtime/tools/worker-sandbox";
import { markPluginCommand } from "./plugin-command-origin";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import {
	getPluginSandboxLauncher,
	resolvePluginRuntimeDirectory,
} from "./plugin-runtime";
import type { PluginTargeting } from "./plugin-targeting";

export const CLINE_PLUGIN_IDLE_TIMEOUT_MS_ENV = "CLINE_PLUGIN_IDLE_TIMEOUT_MS";

/**
 * Absolute path to a compiled `plugin-sandbox-bootstrap.js`, for hosts that
 * ship it somewhere this module cannot find on its own (an app bundle's
 * resources directory).
 */
export const CLINE_PLUGIN_BOOTSTRAP_PATH_ENV = "CLINE_PLUGIN_BOOTSTRAP_PATH";
export const DEFAULT_PLUGIN_SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type SandboxedPluginSetupContext = Pick<
	PluginSetupContext,
	"session" | "client" | "user" | "workspaceInfo" | "logger"
>;

/**
 * Where sandboxed plugins run. `subprocess` spawns a `node`/`bun` child and
 * needs one on PATH; `worker` runs a worker thread inside the host runtime.
 */
export type PluginSandboxTransport = "subprocess" | "worker";

/** The call/shutdown surface both sandbox transports share. */
type SandboxChannel = Pick<SubprocessSandbox, "call" | "shutdown">;

export interface PluginSandboxOptions extends PluginTargeting {
	pluginPaths: string[];
	/** Defaults to `subprocess`. */
	transport?: PluginSandboxTransport;
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
	/**
	 * Reclaim the plugin subprocess after this much time with no calls in
	 * flight. Defaults to 30 minutes and can be overridden with
	 * `CLINE_PLUGIN_IDLE_TIMEOUT_MS`.
	 */
	idleTimeoutMs?: number;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
	/** Worker transport only: the worker ended on its own (crash, exit). */
	onUnexpectedExit?: (error: Error) => void;
	/**
	 * Limit for each plugin's `setup()`, timed inside the sandbox and
	 * separately from the import. When set, the initialize call may take
	 * `importTimeoutMs + setupTimeoutMs`.
	 */
	setupTimeoutMs?: number;
	/** A plugin finished importing and its `setup()` is starting. */
	onSetupStarted?: (pluginPath: string) => void;
	/**
	 * Session plugin policy, applied inside the sandbox after each plugin is
	 * imported (when its own name is known) and before its `setup()` runs.
	 */
	policy?: Record<string, { enabled?: boolean } | undefined>;
	/** Per plugin path: other names the policy may use (its file name). */
	policyNames?: Record<string, string[]>;
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
	/**
	 * Enables the telemetry bridge (`ctx.telemetry`) for sandboxed plugins.
	 * Set only when the host has a live telemetry service to route
	 * `plugin_telemetry` events into, so plugin feature-detection of
	 * `ctx.telemetry` means "someone is listening" in both execution modes.
	 */
	telemetryAvailable?: boolean;
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
	/** Tools: the rest of the tool definition (lifecycle, executionMode, ...). */
	definition?: Record<string, unknown>;
};

/**
 * Internal sandbox events, never forwarded to the session. Keep in sync with
 * plugin-sandbox-bootstrap.ts.
 */
const TOOL_UPDATE_EVENT = "__cline_tool_update";
const SETUP_STARTED_EVENT = "__cline_setup_started";

/** Progress callbacks of tool calls in flight, by call id. */
type ToolUpdateRoutes = Map<string, (update: unknown) => void>;

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
		mcpServers: AgentExtensionMcpServer[];
		shortcuts?: SandboxedContributionDescriptor[];
		flags?: SandboxedContributionDescriptor[];
	};
};

type SandboxedInitializeResult = {
	plugins: SandboxedPluginDescriptor[];
	disabledByPolicy?: Array<{ pluginPath: string; name: string }>;
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
			mcpServers: descriptor.contributions?.mcpServers ?? [],
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
 * Pick the bootstrap the sandbox subprocess should run.
 *
 * Sibling compiled candidates always match the running host build, so they
 * win. When the host runs from source (the `.ts` bootstrap exists next to
 * this module), the sandbox must run that SAME source bootstrap: the
 * wrapper/executable fallbacks locate compiled bootstraps from a separately
 * installed CLI package (e.g. a published version in the package-manager
 * cache), and mixing that code with a source host silently breaks plugin
 * loading because its module resolution points at the other installation's
 * layout. Those fallbacks exist only for compiled hosts
 * (`bun build --compile`) where import.meta points inside the binary and no
 * sibling file exists on real disk.
 */
export function selectBootstrapCandidate(options: {
	siblingCandidates: string[];
	sourceBootstrapPath: string;
	installedCandidates: Array<string | undefined>;
	exists?: (path: string) => boolean;
}): { file: string } | { sourcePath: string } | undefined {
	const exists = options.exists ?? existsSync;
	for (const candidate of options.siblingCandidates) {
		if (exists(candidate)) return { file: candidate };
	}
	if (exists(options.sourceBootstrapPath)) {
		return { sourcePath: options.sourceBootstrapPath };
	}
	for (const candidate of options.installedCandidates) {
		if (candidate && exists(candidate)) return { file: candidate };
	}
	return undefined;
}

/**
 * Resolve the bootstrap for the sandbox worker or subprocess, or `undefined`
 * when this host ships none.
 *
 * In production (bundled), the compiled `.js` file lives next to this module
 * and can be passed directly as a file to spawn. In development/test
 * (unbundled, where only the `.ts` source exists), we load the TypeScript
 * bootstrap through jiti from an inline script.
 */
function resolveBootstrap():
	| { file: string }
	| { script: string; sourcePath: string }
	| undefined {
	const dir = dirname(fileURLToPath(import.meta.url));
	const requireFromHere = createRequire(import.meta.url);
	// In dev, the bootstrap sits next to this file in src/extensions/.
	// In production, the main bundle is at dist/ and the bootstrap is emitted
	// under dist/extensions/. Keep the older dist/agents/ fallback for
	// compatibility with previously built layouts.
	const configured = process.env[CLINE_PLUGIN_BOOTSTRAP_PATH_ENV]?.trim();
	if (configured && existsSync(configured)) {
		return { file: configured };
	}
	const sourceBootstrapPath = join(dir, "plugin-sandbox-bootstrap.ts");
	// Source hosts must execute the current bootstrap and module importer,
	// even when an earlier SDK build left a packaged runtime on disk.
	const runtimeDirectory = existsSync(sourceBootstrapPath)
		? undefined
		: resolvePluginRuntimeDirectory();
	if (runtimeDirectory)
		return { file: join(runtimeDirectory, "plugin-sandbox-bootstrap.js") };
	const selected = selectBootstrapCandidate({
		siblingCandidates: [
			join(dir, "plugin-sandbox-bootstrap.js"),
			// Hosts whose package.json is not `"type": "module"` (the VS Code
			// extension) ship it as .mjs so Node loads it as ESM.
			join(dir, "plugin-sandbox-bootstrap.mjs"),
			join(dir, "extensions", "plugin-sandbox-bootstrap.js"),
			join(dir, "agents", "plugin-sandbox-bootstrap.js"),
		],
		sourceBootstrapPath,
		installedCandidates: [
			resolveBootstrapFromWrapper(),
			resolveBootstrapFromExecutable(),
		],
	});
	if (!selected || "file" in selected) {
		return selected;
	}
	const tsPath = selected.sourcePath;
	let jitiSpecifier = "jiti";
	try {
		jitiSpecifier = requireFromHere.resolve("jiti");
	} catch {
		// Fall back to bare specifier and let runtime resolution handle it.
	}
	return {
		sourcePath: tsPath,
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

let resolvedBootstrap: ReturnType<typeof resolveBootstrap> | undefined;
let bootstrapUnavailableForTests = false;

/**
 * Resolved on first use, not at import, so a host can set
 * `CLINE_PLUGIN_BOOTSTRAP_PATH` after loading this module. A host that ships
 * no bootstrap cannot run plugins at all: plugin code never runs on a host's
 * main thread, so the load fails instead.
 */
function getBootstrap(): NonNullable<ReturnType<typeof resolveBootstrap>> {
	if (bootstrapUnavailableForTests) {
		throw new PluginBootstrapMissingError();
	}
	resolvedBootstrap ??= resolveBootstrap();
	if (!resolvedBootstrap) {
		throw new PluginBootstrapMissingError();
	}
	return resolvedBootstrap;
}

/**
 * @internal Test hook: behave as a host that ships no bootstrap. Tests run
 * from source, where the `.ts` bootstrap always resolves.
 */
export function setPluginBootstrapUnavailableForTests(
	unavailable: boolean,
): void {
	bootstrapUnavailableForTests = unavailable;
}

/** This build ships no `plugin-sandbox-bootstrap.js`, so no plugin can run. */
export class PluginBootstrapMissingError extends Error {
	constructor() {
		super(
			"This build does not ship plugin-sandbox-bootstrap.js, so plugins cannot run. " +
				`Set ${CLINE_PLUGIN_BOOTSTRAP_PATH_ENV} to a copy of the file, or reinstall Cline.`,
		);
		this.name = "PluginBootstrapMissingError";
	}
}

/**
 * The result of a sandbox load when the host ships no bootstrap: every plugin
 * is reported failed at import with the same error, so listings and session
 * starts show the cause instead of silently dropping the plugins.
 */
function pluginBootstrapMissingResult(
	pluginPaths: ReadonlyArray<string>,
	error: PluginBootstrapMissingError,
): Awaited<ReturnType<typeof loadSandboxedPlugins>> {
	return {
		extensions: [],
		pluginPaths: [],
		disabledByPolicy: [],
		warnings: [],
		failures: pluginPaths.map((pluginPath) => ({
			pluginPath,
			phase: "load" as const,
			message: error.message,
			stack: error.stack,
		})),
		shutdown: async () => {},
	};
}

function withTimeoutFallback(
	timeoutMs: number | undefined,
	fallback: number,
	envVarName?: string,
): number {
	if (
		typeof timeoutMs === "number" &&
		Number.isInteger(timeoutMs) &&
		timeoutMs > 0 &&
		timeoutMs <= MAX_NODE_TIMER_DELAY_MS
	) {
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
			if (
				Number.isInteger(parsed) &&
				parsed > 0 &&
				parsed <= MAX_NODE_TIMER_DELAY_MS
			) {
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
		/** Plugins the `policy` turned off; their setup did not run. */
		disabledByPolicy: Array<{ pluginPath: string; name: string }>;
		shutdown: () => Promise<void>;
	} & PluginLoadDiagnostics
> {
	const idleTimeoutMs = withTimeoutFallback(
		options.idleTimeoutMs,
		DEFAULT_PLUGIN_SANDBOX_IDLE_TIMEOUT_MS,
		CLINE_PLUGIN_IDLE_TIMEOUT_MS_ENV,
	);
	let resolved: ReturnType<typeof getBootstrap>;
	try {
		resolved = getBootstrap();
	} catch (error) {
		if (error instanceof PluginBootstrapMissingError) {
			return pluginBootstrapMissingResult(options.pluginPaths, error);
		}
		throw error;
	}
	const bootstrap =
		"file" in resolved
			? { bootstrapFile: resolved.file }
			: { bootstrapScript: resolved.script };
	const importTimeoutMs = withTimeoutFallback(
		options.importTimeoutMs,
		4000,
		"CLINE_PLUGIN_IMPORT_TIMEOUT_MS",
	);
	const hookTimeoutMs = withTimeoutFallback(options.hookTimeoutMs, 3000);
	const setupTimeoutMs =
		options.setupTimeoutMs === undefined
			? undefined
			: withTimeoutFallback(options.setupTimeoutMs, 4000);
	const initTimeoutMs = importTimeoutMs + (setupTimeoutMs ?? 0);
	const toolUpdates: ToolUpdateRoutes = new Map();
	const onEvent = (event: { name: string; payload?: unknown }) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (event.name === TOOL_UPDATE_EVENT) {
			toolUpdates.get(String(payload?.callId))?.(payload?.update);
			return;
		}
		if (event.name === SETUP_STARTED_EVENT) {
			options.onSetupStarted?.(String(payload?.pluginPath));
			return;
		}
		options.onEvent?.(event);
	};
	// One sandbox per call: each session gets its own process or worker.
	const sandbox: SandboxChannel =
		options.transport === "worker"
			? new WorkerSandbox({
					name: "plugin-worker",
					...bootstrap,
					idleTimeoutMs,
					onEvent,
					onUnexpectedExit: options.onUnexpectedExit,
					// Runs ctx.onDispose cleanup before an idle reclaim or shutdown.
					disposeMethod: "dispose",
					disposeTimeoutMs: hookTimeoutMs,
				})
			: new SubprocessSandbox({
					name: "plugin-sandbox",
					launcher:
						"bootstrapFile" in bootstrap
							? getPluginSandboxLauncher()
							: undefined,
					...bootstrap,
					idleTimeoutMs,
					onEvent,
				});
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
		telemetryEnabled: options.telemetryAvailable === true,
		setupTimeoutMs,
		policy: options.policy,
		policyNames: options.policyNames,
	};

	// Guard against concurrent re-initialization when multiple tools/hooks
	// fail simultaneously with "Unknown sandbox plugin id:".
	let reinitPromise: Promise<void> | undefined;
	const reinitialize = (): Promise<void> => {
		reinitPromise ??= sandbox
			.call<void>("initialize", initArgs, { timeoutMs: initTimeoutMs })
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
			{ timeoutMs: initTimeoutMs },
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
						toolUpdates,
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
		disabledByPolicy: initialized.disabledByPolicy ?? [],
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

/**
 * Tool contexts and hook payloads cross the sandbox boundary over JSON IPC
 * (subprocess) or structured clone (worker), so they must be plain data. Host code must not place
 * live host objects (telemetry services, sockets, abort signals) on them,
 * but a single offender would otherwise fail every sandboxed call — the
 * telemetry service on toolContextMetadata did exactly that ("JSON.stringify
 * cannot serialize cyclic structures"). These helpers are the safety net:
 * the first attempt sends the payload untouched (no extra serialization on
 * the happy path); only when the runtime rejects it as non-serializable do
 * we retry with a JSON-safe clone and warn.
 */
function isSerializationError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	// Bun: "JSON.stringify cannot serialize cyclic structures." /
	//      "JSON.stringify cannot serialize BigInt."
	// Node: "Converting circular structure to JSON" /
	//       "Do not know how to serialize a BigInt"
	// Worker: DataCloneError "... could not be cloned" (Node) /
	//         "The object can not be cloned" (Bun)
	return /cyclic|circular|bigint|can ?not be cloned|could not be cloned/i.test(
		message,
	);
}

/**
 * Deep-clone into a JSON-safe shape: cycles and non-serializable leaves
 * (functions, symbols, bigints) are dropped, `toJSON` (e.g. Date) is
 * honored. Fallback path only — never run on the happy path.
 */
function toJsonSafePayload(
	value: unknown,
	ancestors = new WeakSet<object>(),
): unknown {
	if (value === null || typeof value !== "object") {
		return typeof value === "function" ||
			typeof value === "symbol" ||
			typeof value === "bigint"
			? undefined
			: value;
	}
	if (ancestors.has(value)) {
		return undefined;
	}
	const withToJson = value as { toJSON?: () => unknown };
	if (typeof withToJson.toJSON === "function") {
		try {
			return withToJson.toJSON();
		} catch {
			return undefined;
		}
	}
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((entry) => toJsonSafePayload(entry, ancestors) ?? null);
		}
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			const safe = toJsonSafePayload(entry, ancestors);
			if (safe !== undefined) {
				out[key] = safe;
			}
		}
		return out;
	} finally {
		ancestors.delete(value);
	}
}

const warnedNonSerializablePayloads = new Set<string>();

function warnNonSerializablePayloadOnce(
	kind: "tool" | "hook",
	name: string,
	error: unknown,
): void {
	const key = `${kind}:${name}`;
	if (warnedNonSerializablePayloads.has(key)) {
		return;
	}
	warnedNonSerializablePayloads.add(key);
	const message = error instanceof Error ? error.message : String(error);
	console.warn(
		`[plugin-sandbox] ${kind} "${name}" received a payload that is not JSON-serializable (${message}); ` +
			"retrying with non-serializable values dropped. Host-only objects must not be placed on tool contexts or hook payloads.",
	);
}

/**
 * Invoke a sandbox call with the raw payload; if the IPC layer rejects it as
 * non-serializable, retry once with a JSON-safe clone instead of failing the
 * call.
 */
async function callWithSerializableFallback<T>(
	invoke: (payload: unknown) => Promise<T>,
	payload: unknown,
	onSanitized: (error: unknown) => void,
): Promise<T> {
	try {
		return await invoke(payload);
	} catch (error) {
		if (!isSerializationError(error)) {
			throw error;
		}
		onSanitized(error);
		return await invoke(toJsonSafePayload(payload));
	}
}

let toolCallCounter = 0;

function registerTools(
	api: AgentExtensionApi,
	sandbox: SandboxChannel,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
	toolUpdates: ToolUpdateRoutes,
): void {
	for (const td of descriptor.contributions?.tools ?? []) {
		const tool: AgentTool = {
			// The full definition (lifecycle, executionMode, resultPolicy, ...)
			// so the runtime treats the tool as the plugin declared it.
			...(td.definition ?? {}),
			name: td.name,
			description: td.description ?? "",
			inputSchema: (td.inputSchema ?? {
				type: "object",
				properties: {},
			}) as AgentTool["inputSchema"],
			timeoutMs: td.timeoutMs,
			retryable: td.retryable,
			execute: async (input: unknown, context: AgentToolContext) => {
				// The live parts of the context cannot cross the boundary. The
				// sandbox rebuilds them: an abort signal driven by `abortToolCall`,
				// progress updates routed back by call id, and session events
				// (which already reach the session through the sandbox's events).
				const {
					signal,
					emitUpdate,
					emitEvent: _emitEvent,
					...plainContext
				} = context ?? ({} as AgentToolContext);
				const callId = `${descriptor.pluginId}:${++toolCallCounter}`;
				if (emitUpdate) toolUpdates.set(callId, emitUpdate);
				const onAbort = () => {
					sandbox
						.call("abortToolCall", {
							callId,
							reason:
								signal?.reason instanceof Error
									? signal.reason.message
									: undefined,
						})
						.catch(() => {
							// The call may already have finished.
						});
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				// The fallback must cover the whole IPC payload: `input` can be
				// rewritten by beforeTool hooks or programmatic callers, so it is
				// just as capable of smuggling a non-serializable value as the
				// context is.
				const invoke = async (payload: unknown) => {
					const { input: sandboxInput, context: sandboxContext } = payload as {
						input: unknown;
						context: unknown;
					};
					const callArgs = () => ({
						pluginId: descriptor.pluginId,
						contributionId: td.id,
						input: sandboxInput,
						context: sandboxContext,
						callId,
						aborted: signal?.aborted === true,
					});
					try {
						return await sandbox.call("executeTool", callArgs(), {
							timeoutMs: td.timeoutMs ?? timeoutMs,
						});
					} catch (error) {
						if (!isUnknownPluginIdError(error)) {
							throw error;
						}
						await reinitialize();
						return await sandbox.call("executeTool", callArgs(), {
							timeoutMs: td.timeoutMs ?? timeoutMs,
						});
					}
				};
				try {
					return await callWithSerializableFallback(
						invoke,
						{ input, context: plainContext },
						(error) => warnNonSerializablePayloadOnce("tool", td.name, error),
					);
				} finally {
					signal?.removeEventListener("abort", onAbort);
					toolUpdates.delete(callId);
				}
			},
		};
		api.registerTool(tool);
	}
}

function registerCommands(
	api: AgentExtensionApi,
	sandbox: SandboxChannel,
	descriptor: SandboxedPluginDescriptor,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): void {
	for (const cd of descriptor.contributions?.commands ?? []) {
		api.registerCommand(
			markPluginCommand({
				name: cd.name,
				description: cd.description,
				handler: async (input: string) => {
					try {
						return await sandbox.call<AgentExtensionCommandResult>(
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
						return await sandbox.call<AgentExtensionCommandResult>(
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
			}),
		);
	}
}

function registerRules(
	api: AgentExtensionApi,
	sandbox: SandboxChannel,
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

	for (const mcpServer of descriptor.contributions?.mcpServers ?? []) {
		api.registerMcpServer(mcpServer);
	}
}

function registerMessageBuilders(
	api: AgentExtensionApi,
	sandbox: SandboxChannel,
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
	sandbox: SandboxChannel,
	pluginId: string,
	hookName: string,
	timeoutMs: number,
	reinitialize: () => Promise<void>,
): (payload: unknown) => Promise<unknown> {
	return async (payload: unknown) => {
		const invoke = async (sandboxPayload: unknown) => {
			try {
				return await sandbox.call(
					"invokeHook",
					{ pluginId, hookName, payload: sandboxPayload },
					{ timeoutMs },
				);
			} catch (error) {
				if (!isUnknownPluginIdError(error)) {
					throw error;
				}
				await reinitialize();
				return await sandbox.call(
					"invokeHook",
					{ pluginId, hookName, payload: sandboxPayload },
					{ timeoutMs },
				);
			}
		};
		return await callWithSerializableFallback(invoke, payload, (error) =>
			warnNonSerializablePayloadOnce("hook", hookName, error),
		);
	};
}

function createSandboxRuntimeHooks(
	sandbox: SandboxChannel,
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
