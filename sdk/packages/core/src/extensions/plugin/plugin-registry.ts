import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionCommand,
	AgentExtensionMessageBuilder,
	AgentExtensionRule,
	AgentTool,
	AgentToolContext,
	BasicLogger,
	Message,
	PluginErrorPhase,
	PluginErrorRecord,
	PluginPolicies,
	PluginRuntimeState,
	PluginSetupContext,
	PluginStatusRecord,
	SessionPluginIssue,
} from "@cline/shared";
import { getPluginDisplayName } from "@cline/shared/storage";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "./plugin-load-report";
import { loadAgentPluginFromPath } from "./plugin-loader";
import { fingerprintPluginSources } from "./plugin-module-import";
import {
	matchesPluginManifestTargeting,
	type PluginTargeting,
} from "./plugin-targeting";

export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_SETUP_TIMEOUT_MS = 4_000;
export const DEFAULT_PLUGIN_HOOK_TIMEOUT_MS = 3_000;
/** Tools, commands, rule content, and message builders. */
export const DEFAULT_PLUGIN_TOOL_TIMEOUT_MS = 60_000;
/** Consecutive call failures after which a plugin is turned off. */
export const DEFAULT_PLUGIN_FAILURE_THRESHOLD = 5;

const PLUGIN_IMPORT_TIMEOUT_ENV = "CLINE_PLUGIN_IMPORT_TIMEOUT_MS";

export type PluginHookErrorMode = "ignore" | "throw";

export class PluginCallTimeoutError extends Error {
	constructor(
		readonly label: string,
		readonly timeoutMs: number,
	) {
		super(`${label} timed out after ${timeoutMs}ms`);
		this.name = "PluginCallTimeoutError";
	}
}

type ExtensionHooks = NonNullable<AgentExtension["hooks"]>;
type HookFn = (...args: unknown[]) => unknown;
type SetupApi = AgentExtensionApi<AgentTool, Message[]>;

interface PluginEntry {
	pluginPath: string;
	/** Directory (package plugins) or file path used to attribute stack frames. */
	attributionRoot: string;
	name: string;
	state: PluginRuntimeState;
	/**
	 * Set when the plugin is turned off for every session: import or discovery
	 * failed, a stray error was attributed to it, or calls kept failing. A
	 * `setup()` failure alone is per session and does not set this.
	 */
	blocked: boolean;
	consecutiveFailures: number;
	/** The imported module, read for metadata (name, manifest). */
	extension?: AgentExtension;
	/**
	 * An imported copy no session has used yet. The first session claims it;
	 * later sessions import their own copy so module state is per session.
	 */
	spare?: PluginInstance;
	fingerprint?: string;
	lastError?: PluginErrorRecord;
	errorCount: number;
	timeoutCount: number;
	/** Sessions holding a copy, with their `onIssue` callback. */
	sessions: Map<string, ((issue: SessionPluginIssue) => void) | undefined>;
	loading?: Promise<void>;
	updatedAt: number;
}

/** One session's copy of a plugin module. */
interface PluginInstance {
	extension: AgentExtension;
	setupFailed: boolean;
	closed: boolean;
	/** Cleanup registered through `ctx.onDispose`. */
	disposers: Array<() => void | Promise<void>>;
	/**
	 * The async scope every call into this copy runs in, created at import.
	 * Work the module starts at import time keeps this scope, so claiming the
	 * copy for a session fills in its session id and event callback here
	 * rather than in a new scope that work would never see.
	 */
	scope: PluginCallScope;
}

interface PluginCallScope {
	sessionId?: string;
	pluginName: string;
	emitEvent?: (name: string, payload?: unknown) => void;
}

interface PluginTimeouts {
	import: number;
	setup: number;
	hook: number;
	call: number;
}

export interface PluginRegistryOptions {
	logger?: BasicLogger;
	importTimeoutMs?: number;
	setupTimeoutMs?: number;
	hookTimeoutMs?: number;
	toolTimeoutMs?: number;
	failureThreshold?: number;
}

export interface PluginSessionLoadInput extends PluginTargeting {
	sessionId?: string;
	/** Resolved, enabled plugin module paths, in load order. */
	pluginPaths: ReadonlyArray<string>;
	/** Plugin paths turned off in settings; reported as `disabled`. */
	disabledPluginPaths?: ReadonlyArray<string>;
	/** Configured paths that could not be resolved to a module. */
	discoveryFailures?: ReadonlyArray<{ pluginPath: string; error: unknown }>;
	policy?: PluginPolicies;
	exportName?: string;
	cwd?: string;
	hookErrorMode?: PluginHookErrorMode;
	setupContext?: PluginSetupContext;
	emitEvent?: (event: { name: string; payload?: unknown }) => void;
	/**
	 * Called when a call made for this session moves a plugin to `degraded`
	 * or `failed`. Setup runs lazily on the first turn, after the session
	 * start payload went out, so this is how those failures reach the user.
	 */
	onIssue?: (issue: SessionPluginIssue) => void;
	/** Per-session overrides of the registry's default timeouts. */
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	/** Tools (without their own `timeoutMs`), commands, rules, builders. */
	callTimeoutMs?: number;
}

export interface PluginSessionLoadResult {
	extensions: AgentExtension[];
	pluginPaths: string[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
	issues: SessionPluginIssue[];
	/**
	 * Ends the session's use of its plugin copies: runs `ctx.onDispose`
	 * cleanup and stops further calls.
	 */
	release: () => Promise<void>;
}

export type PluginStatusListener = (status: PluginStatusRecord) => void;

function readTimeoutEnv(name: string): number | undefined {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toErrorParts(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: String(error) };
}

/**
 * Package plugins own their whole package directory; a single-file plugin
 * in a shared `plugins/` folder owns only its file, so a stray error from one
 * drop-in file is never blamed on its neighbours.
 */
function resolveAttributionRoot(pluginPath: string): string {
	let current = dirname(pluginPath);
	for (let depth = 0; depth < 4; depth++) {
		const manifestPath = join(current, "package.json");
		if (existsSync(manifestPath)) {
			try {
				const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
				if (pkg && typeof pkg === "object" && "cline" in pkg) {
					return current;
				}
			} catch {
				// Malformed manifest: fall back to the file itself.
			}
			return pluginPath;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return pluginPath;
}

/** Name used before the module is imported (or when it never imports). */
function derivePluginName(pluginPath: string, attributionRoot: string): string {
	return attributionRoot === pluginPath
		? basename(pluginPath, extname(pluginPath))
		: getPluginDisplayName(pluginPath, attributionRoot);
}

/** The name a plugin is known by before its module is imported. */
export function derivePluginNameFromPath(pluginPath: string): string {
	const absolute = resolve(pluginPath);
	return derivePluginName(absolute, resolveAttributionRoot(absolute));
}

/**
 * Windows stack frames may spell a path differently from how it was
 * configured (case, separators, 8.3 short names such as `RUNNER~1`), so
 * compare a normalized form there.
 */
function normalizeStackPath(value: string): string {
	return process.platform === "win32"
		? value.replace(/\\/g, "/").toLowerCase()
		: value;
}

function stackMentionsPath(stack: string, root: string): boolean {
	const roots = new Set([root]);
	try {
		// Module resolution follows symlinks and expands short names, so the
		// stack may name the real path rather than the configured one.
		roots.add(realpathSync.native(root));
	} catch {
		// A missing root can only match by its configured spelling.
	}
	const haystack = normalizeStackPath(stack);
	const candidates = [...roots].flatMap((candidate) => [
		normalizeStackPath(candidate),
		normalizeStackPath(pathToFileURL(candidate).href),
	]);
	return candidates.some((candidate) => {
		let index = haystack.indexOf(candidate);
		while (index !== -1) {
			const next = haystack[index + candidate.length];
			// Require a boundary so /plugins/foo does not match /plugins/foobar.
			if (
				next === undefined ||
				next === sep ||
				next === "/" ||
				next === ":" ||
				next === ")" ||
				next === "?" ||
				/\s/.test(next)
			) {
				return true;
			}
			index = haystack.indexOf(candidate, index + 1);
		}
		return false;
	});
}

function runWithTimeout<T>(
	fn: () => T | Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	return new Promise<T>((resolvePromise, rejectPromise) => {
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			rejectPromise(new PluginCallTimeoutError(label, timeoutMs));
		}, timeoutMs);
		timer.unref?.();
		Promise.resolve()
			.then(fn)
			.then(
				(value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolvePromise(value);
				},
				(error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					rejectPromise(error);
				},
			);
	});
}

/** Applies a `toolPolicies`-shaped plugin policy to a plugin's names. */
function isPluginEnabledByPolicy(
	policy: PluginPolicies | undefined,
	names: ReadonlyArray<string>,
): boolean {
	if (!policy) return true;
	for (const name of names) {
		const enabled = policy[name]?.enabled;
		if (typeof enabled === "boolean") return enabled;
	}
	return policy["*"]?.enabled ?? true;
}

const pluginCallScope = new AsyncLocalStorage<PluginCallScope>();
let lastPluginCallScope: PluginCallScope | undefined;

function runInPluginScope<T>(scope: PluginCallScope, fn: () => T): T {
	lastPluginCallScope = scope;
	return pluginCallScope.run(scope, fn);
}

/**
 * Plugins written for the subprocess sandbox emit events through
 * `globalThis.__clinePluginHost.emitEvent`. In-process, route those calls to
 * the session whose hook or tool is running (async context follows timers and
 * promises the call started), else to the session that last called a plugin.
 */
export function installPluginHostShim(): void {
	const globals = globalThis as Record<string, unknown>;
	if (globals.__clinePluginHost) return;
	globals.__clinePluginHost = {
		emitEvent: (name: string, payload?: unknown) => {
			const scope = pluginCallScope.getStore() ?? lastPluginCallScope;
			scope?.emitEvent?.(name, payload);
		},
	};
}

function newInstance(
	extension: AgentExtension | undefined,
	pluginName: string,
): PluginInstance {
	return {
		// Assigned as soon as the import resolves; never read before that.
		extension: extension as AgentExtension,
		setupFailed: false,
		closed: false,
		disposers: [],
		scope: { pluginName },
	};
}

/**
 * Tracks plugins for the whole process and hands each session a guarded copy
 * of the plugins it enabled. Each session gets its own import of the module,
 * matching the per-session sandbox plugins were written for. Every import,
 * setup, hook, tool, command, rule, and message-builder call is wrapped with
 * a timeout and error capture, and the result is recorded per plugin so
 * failures are visible instead of silently dropping the plugin's tools.
 */
export class PluginRegistry {
	private readonly entries = new Map<string, PluginEntry>();
	private readonly listeners = new Set<PluginStatusListener>();
	private logger: BasicLogger | undefined;
	private readonly defaults: PluginTimeouts;
	private readonly failureThreshold: number;

	constructor(options: PluginRegistryOptions = {}) {
		this.logger = options.logger;
		this.defaults = {
			import:
				options.importTimeoutMs ??
				readTimeoutEnv(PLUGIN_IMPORT_TIMEOUT_ENV) ??
				DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS,
			setup: options.setupTimeoutMs ?? DEFAULT_PLUGIN_SETUP_TIMEOUT_MS,
			hook: options.hookTimeoutMs ?? DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
			call: options.toolTimeoutMs ?? DEFAULT_PLUGIN_TOOL_TIMEOUT_MS,
		};
		this.failureThreshold =
			options.failureThreshold ?? DEFAULT_PLUGIN_FAILURE_THRESHOLD;
		installPluginHostShim();
	}

	setLogger(logger: BasicLogger | undefined): void {
		this.logger = logger;
	}

	subscribe(listener: PluginStatusListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	list(): PluginStatusRecord[] {
		return [...this.entries.values()]
			.map((entry) => this.toStatus(entry))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	get(nameOrPath: string): PluginStatusRecord[] {
		return this.match(nameOrPath).map((entry) => this.toStatus(entry));
	}

	/**
	 * Re-imports the matching plugins and resets their status. Sessions
	 * started afterwards use the new module; running sessions keep the copy
	 * they set up, which stays callable unless the re-import fails (the plugin
	 * is then turned off for every session, failing closed).
	 */
	async reload(nameOrPath: string): Promise<PluginStatusRecord[]> {
		const matches = this.match(nameOrPath);
		for (const entry of matches) {
			entry.fingerprint = undefined;
			entry.lastError = undefined;
			entry.errorCount = 0;
			entry.timeoutCount = 0;
			this.log("info", "plugin.reload", entry, {});
			await this.ensureLoaded(entry.pluginPath, { force: true });
		}
		return matches.map((entry) => this.toStatus(entry));
	}

	/**
	 * Finds the plugin whose module root appears in `error`'s stack and turns
	 * it off for every session. Used by the Hub daemon so a stray plugin error
	 * does not take the process down.
	 */
	attributeUncaughtError(
		error: unknown,
		label = "uncaught",
	): PluginStatusRecord | undefined {
		const stack = error instanceof Error ? error.stack : undefined;
		if (!stack) return undefined;
		// Prefer the most specific root when roots nest.
		const entry = [...this.entries.values()]
			.filter((candidate) =>
				stackMentionsPath(stack, candidate.attributionRoot),
			)
			.sort(
				(left, right) =>
					right.attributionRoot.length - left.attributionRoot.length,
			)[0];
		if (!entry) return undefined;
		this.recordFailure(entry, "uncaught", error, {
			fatal: true,
			messagePrefix: `${label}: `,
		});
		return this.toStatus(entry);
	}

	/**
	 * Imports plugins without attaching them to a session, so the Hub can
	 * discover them at startup and report status before any session exists.
	 * The imported copy is kept for the first session to claim.
	 */
	async preload(
		input: Pick<
			PluginSessionLoadInput,
			| "pluginPaths"
			| "disabledPluginPaths"
			| "discoveryFailures"
			| "exportName"
			| "importTimeoutMs"
		>,
	): Promise<PluginStatusRecord[]> {
		this.recordDiscovery(input, []);
		for (const rawPath of input.pluginPaths) {
			await this.ensureLoaded(resolve(rawPath), {
				exportName: input.exportName,
				importTimeoutMs: input.importTimeoutMs,
			});
		}
		return this.list();
	}

	async loadForSession(
		input: PluginSessionLoadInput,
	): Promise<PluginSessionLoadResult> {
		const failures: PluginInitializationFailure[] = [];
		const warnings: PluginInitializationWarning[] = [];
		const issues: SessionPluginIssue[] = [];
		const sessionId = input.sessionId;
		const timeouts = this.resolveTimeouts(input);

		for (const entry of this.recordDiscovery(input, issues)) {
			failures.push(this.toInitializationFailure(entry));
		}

		const loadedByName = new Map<
			string,
			{ entry: PluginEntry; order: number }
		>();
		let order = 0;
		for (const rawPath of input.pluginPaths) {
			const pluginPath = resolve(rawPath);
			const entry = await this.ensureLoaded(pluginPath, {
				exportName: input.exportName,
				importTimeoutMs: timeouts.import,
			});
			const enabledByPolicy = this.isEnabledForSession(entry, input);
			if (entry.blocked || entry.state === "disabled" || !entry.extension) {
				// A broken plugin the session turned off is not this session's
				// problem; report it as disabled rather than as a failure.
				if (!enabledByPolicy) {
					issues.push(this.policyIssue(entry));
					continue;
				}
				if (entry.state === "failed") {
					failures.push(this.toInitializationFailure(entry));
				}
				issues.push(
					this.toIssue(
						entry,
						entry.state === "disabled" ? "settings" : "error",
					),
				);
				continue;
			}
			if (!matchesPluginManifestTargeting(entry.extension.manifest, input)) {
				continue;
			}
			if (!enabledByPolicy) {
				issues.push(this.policyIssue(entry));
				continue;
			}
			const existing = loadedByName.get(entry.name);
			if (existing) {
				warnings.push({
					type: "duplicate_plugin_override",
					pluginName: entry.name,
					pluginPath,
					overriddenPluginPath: existing.entry.pluginPath,
					message: `Plugin "${entry.name}" from ${pluginPath} overrides ${existing.entry.pluginPath}`,
				});
			}
			loadedByName.set(entry.name, { entry, order: order++ });
		}

		const ordered = [...loadedByName.values()].sort(
			(left, right) => left.order - right.order,
		);
		const selected: Array<{ entry: PluginEntry; instance: PluginInstance }> =
			[];
		for (const { entry } of ordered) {
			try {
				const instance = await this.claimInstance(
					entry,
					input.exportName,
					timeouts,
					sessionId,
				);
				selected.push({ entry, instance });
			} catch (error) {
				this.recordFailure(entry, "import", error, {
					fatal: true,
					sessionId,
				});
				failures.push(this.toInitializationFailure(entry));
				issues.push(this.toIssue(entry, "error"));
			}
		}
		if (sessionId) {
			for (const { entry } of selected) {
				entry.sessions.set(sessionId, input.onIssue);
			}
		}
		const extensions = selected.map(({ entry, instance }) =>
			this.wrapForSession(entry, instance, input, timeouts),
		);
		let released: Promise<void> | undefined;
		return {
			extensions,
			pluginPaths: selected.map(({ entry }) => entry.pluginPath),
			failures,
			warnings,
			issues,
			release: () => {
				released ??= Promise.all(
					selected.map(({ entry, instance }) =>
						this.releaseInstance(entry, instance, sessionId, timeouts),
					),
				).then(() => undefined);
				return released;
			},
		};
	}

	/**
	 * Records discovery failures and settings-disabled plugins. Settings-
	 * disabled plugins the session would otherwise use are reported as issues
	 * with `reason: "settings"`. Returns the entries that failed discovery.
	 */
	private recordDiscovery(
		input: Pick<
			PluginSessionLoadInput,
			"disabledPluginPaths" | "discoveryFailures" | "policy" | "sessionId"
		>,
		issues: SessionPluginIssue[],
	): PluginEntry[] {
		const failed: PluginEntry[] = [];
		for (const { pluginPath, error } of input.discoveryFailures ?? []) {
			const entry = this.ensureEntry(pluginPath);
			this.recordFailure(entry, "discover", error, {
				fatal: true,
				sessionId: input.sessionId,
			});
			failed.push(entry);
			issues.push(this.toIssue(entry, "error"));
		}
		for (const pluginPath of input.disabledPluginPaths ?? []) {
			const entry = this.ensureEntry(pluginPath);
			if (entry.state !== "disabled") {
				entry.extension = undefined;
				entry.spare = undefined;
				this.setState(entry, "disabled");
			}
			if (this.isEnabledForSession(entry, input)) {
				issues.push(this.toIssue(entry, "settings"));
			}
		}
		return failed;
	}

	private isEnabledForSession(
		entry: PluginEntry,
		input: Pick<PluginSessionLoadInput, "policy">,
	): boolean {
		return isPluginEnabledByPolicy(input.policy, [
			entry.name,
			derivePluginName(entry.pluginPath, entry.attributionRoot),
		]);
	}

	private policyIssue(entry: PluginEntry): SessionPluginIssue {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: "disabled",
			reason: "session_policy",
		};
	}

	private resolveTimeouts(input: PluginSessionLoadInput): PluginTimeouts {
		return {
			import: input.importTimeoutMs ?? this.defaults.import,
			setup: this.defaults.setup,
			hook: input.hookTimeoutMs ?? this.defaults.hook,
			call: input.callTimeoutMs ?? this.defaults.call,
		};
	}

	private match(nameOrPath: string): PluginEntry[] {
		const target = nameOrPath.trim();
		if (!target) return [];
		const absolute = resolve(target);
		return [...this.entries.values()].filter(
			(entry) =>
				entry.pluginPath === absolute ||
				entry.name === target ||
				derivePluginName(entry.pluginPath, entry.attributionRoot) === target,
		);
	}

	private ensureEntry(pluginPath: string): PluginEntry {
		const absolute = resolve(pluginPath);
		let entry = this.entries.get(absolute);
		if (!entry) {
			const attributionRoot = resolveAttributionRoot(absolute);
			entry = {
				pluginPath: absolute,
				attributionRoot,
				name: derivePluginName(absolute, attributionRoot),
				state: "loading",
				blocked: false,
				consecutiveFailures: 0,
				errorCount: 0,
				timeoutCount: 0,
				sessions: new Map(),
				updatedAt: Date.now(),
			};
			this.entries.set(absolute, entry);
		}
		return entry;
	}

	private async ensureLoaded(
		pluginPath: string,
		options: { force?: boolean; exportName?: string; importTimeoutMs?: number },
	): Promise<PluginEntry> {
		const entry = this.ensureEntry(pluginPath);
		if (entry.loading) {
			await entry.loading;
			return entry;
		}
		const fingerprint = fingerprintPluginSources(entry.pluginPath);
		const upToDate =
			!options.force &&
			entry.fingerprint === fingerprint &&
			entry.state !== "disabled" &&
			entry.state !== "loading";
		if (upToDate) return entry;

		entry.loading = this.importEntry(
			entry,
			fingerprint,
			options.exportName,
			options.importTimeoutMs ?? this.defaults.import,
		);
		try {
			await entry.loading;
		} finally {
			entry.loading = undefined;
		}
		return entry;
	}

	/** Imports one copy of the module in its own call scope. */
	private async importCopy(
		entry: PluginEntry,
		exportName: string | undefined,
		timeoutMs: number,
		sessionId: string | undefined,
	): Promise<PluginInstance> {
		const instance = newInstance(undefined, entry.name);
		instance.scope.sessionId = sessionId;
		instance.extension = await runWithTimeout(
			() =>
				runInPluginScope(instance.scope, () =>
					loadAgentPluginFromPath(entry.pluginPath, {
						exportName,
						freshModule: true,
					}),
				),
			timeoutMs,
			`Plugin import of ${entry.pluginPath}`,
		);
		return instance;
	}

	/**
	 * Hands a session its own copy of the plugin module. Plugins written for
	 * the per-session sandbox keep state at module level (one plugin object
	 * per import), so sharing one copy across sessions would break them.
	 */
	private async claimInstance(
		entry: PluginEntry,
		exportName: string | undefined,
		timeouts: PluginTimeouts,
		sessionId: string | undefined,
	): Promise<PluginInstance> {
		const spare = entry.spare;
		if (spare) {
			entry.spare = undefined;
			return spare;
		}
		return this.importCopy(entry, exportName, timeouts.import, sessionId);
	}

	private async importEntry(
		entry: PluginEntry,
		fingerprint: string,
		exportName: string | undefined,
		importTimeoutMs: number,
	): Promise<void> {
		entry.fingerprint = fingerprint;
		entry.extension = undefined;
		entry.spare = undefined;
		this.setState(entry, "loading", true);
		const startedAt = Date.now();
		try {
			const instance = await this.importCopy(
				entry,
				exportName,
				importTimeoutMs,
				undefined,
			);
			// A successful re-import (reload or source change) gives the plugin
			// a clean slate, including failures copies recorded while it ran.
			entry.blocked = false;
			entry.consecutiveFailures = 0;
			entry.extension = instance.extension;
			entry.spare = instance;
			entry.name = instance.extension.name;
			this.setState(entry, "ready");
			this.log("info", "plugin.import.ready", entry, {
				elapsedMs: Date.now() - startedAt,
			});
		} catch (error) {
			this.recordFailure(entry, "import", error, { fatal: true });
		}
	}

	private wrapForSession(
		entry: PluginEntry,
		instance: PluginInstance,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtension {
		const extension = instance.extension;
		const sessionId = input.sessionId;
		const emitEvent = input.emitEvent
			? (name: string, payload?: unknown) =>
					input.emitEvent?.({ name, payload })
			: undefined;
		// Connect the copy's own scope (the one its import-time work holds) to
		// this session.
		const scope = instance.scope;
		scope.sessionId = sessionId;
		scope.pluginName = entry.name;
		scope.emitEvent = emitEvent;
		const originalSetup = extension.setup;
		const wrapped: AgentExtension & { __clinePluginPath?: string } = {
			...extension,
			__clinePluginPath: entry.pluginPath,
			hooks: this.wrapHooks(
				entry,
				instance,
				extension.hooks,
				scope,
				input,
				timeouts,
			),
			setup: originalSetup
				? async (api, ctx) => {
						if (!this.isUsable(entry, instance)) return;
						const sessionContext = {
							...(input.setupContext?.session ?? {}),
							...(ctx.session ?? {}),
						};
						const setupContext: PluginSetupContext = {
							...(input.setupContext ?? {}),
							...ctx,
							session:
								Object.keys(sessionContext).length > 0
									? sessionContext
									: undefined,
							cwd: input.cwd ?? ctx.cwd,
							emitEvent,
							onDispose: (cleanup) => {
								if (typeof cleanup === "function") {
									instance.disposers.push(cleanup);
								}
							},
						};
						await this.runSetup(
							entry,
							instance,
							(bufferedApi) =>
								originalSetup.call(extension, bufferedApi, setupContext),
							api,
							scope,
							input,
							timeouts,
						);
					}
				: undefined,
		};
		return wrapped;
	}

	private async runSetup(
		entry: PluginEntry,
		instance: PluginInstance,
		invoke: (api: SetupApi) => void | Promise<void>,
		api: SetupApi,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): Promise<void> {
		const pending = {
			tools: [] as AgentTool[],
			commands: [] as AgentExtensionCommand[],
			calls: [] as Array<(target: SetupApi) => void>,
		};
		const capabilities = new Set<string>(
			instance.extension.manifest.capabilities,
		);
		const requireCapability = (capability: string, method: string) => {
			if (!capabilities.has(capability)) {
				throw new Error(`${method} requires the "${capability}" capability`);
			}
		};
		// Buffer registrations so a setup that throws halfway contributes
		// nothing, instead of leaving the session with half a plugin.
		const bufferedApi: SetupApi = {
			registerTool: (tool) => {
				pending.tools.push(tool);
			},
			registerCommand: (command) => {
				pending.commands.push(command);
			},
			registerRule: (rule) => {
				requireCapability("rules", "registerRule");
				const wrappedRule = this.wrapRule(
					entry,
					instance,
					rule,
					scope,
					input,
					timeouts,
				);
				pending.calls.push((target) => target.registerRule(wrappedRule));
			},
			registerMessageBuilder: (builder) => {
				const wrappedBuilder = this.wrapMessageBuilder(
					entry,
					instance,
					builder,
					scope,
					input,
					timeouts,
				);
				pending.calls.push((target) =>
					target.registerMessageBuilder(wrappedBuilder),
				);
			},
			registerProvider: (provider) => {
				pending.calls.push((target) => target.registerProvider(provider));
			},
			registerAutomationEventType: (eventType) => {
				requireCapability("automationEvents", "registerAutomationEventType");
				pending.calls.push((target) =>
					target.registerAutomationEventType(eventType),
				);
			},
			registerMcpServer: (server) => {
				requireCapability("mcp", "registerMcpServer");
				pending.calls.push((target) => target.registerMcpServer(server));
			},
		};
		const failSetup = (error: unknown) => {
			// Setup failure only costs this session its copy of the plugin;
			// other sessions keep theirs, and the next session tries again.
			instance.setupFailed = true;
			this.recordFailure(entry, "setup", error, {
				sessionId: input.sessionId,
				state: "failed",
				notify: input.onIssue,
			});
		};
		const startedAt = Date.now();
		try {
			await runWithTimeout(
				() => runInPluginScope(scope, () => invoke(bufferedApi)),
				timeouts.setup,
				`Plugin "${entry.name}" setup`,
			);
		} catch (error) {
			failSetup(error);
			return;
		}
		this.warnIfSlow(entry, "setup", startedAt, timeouts.setup, input);
		try {
			for (const tool of pending.tools) {
				api.registerTool(
					this.wrapTool(entry, instance, tool, scope, input, timeouts),
				);
			}
			for (const command of pending.commands) {
				api.registerCommand(
					this.wrapCommand(entry, instance, command, scope, input, timeouts),
				);
			}
			for (const call of pending.calls) {
				call(api);
			}
		} catch (error) {
			// The host rejected a registration. Rethrow so the contribution
			// registry discards what this plugin already committed.
			failSetup(error);
			throw error;
		}
		if (!entry.blocked && entry.state === "failed") {
			this.setState(entry, "ready");
		}
	}

	private wrapHooks(
		entry: PluginEntry,
		instance: PluginInstance,
		hooks: ExtensionHooks | undefined,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): ExtensionHooks | undefined {
		if (!hooks) return undefined;
		const wrapped: Record<string, HookFn> = {};
		for (const [hookName, hook] of Object.entries(hooks)) {
			if (typeof hook !== "function") continue;
			const phase: PluginErrorPhase = `hook:${hookName}`;
			wrapped[hookName] = async (...args: unknown[]) => {
				if (!this.isUsable(entry, instance)) return undefined;
				try {
					return await this.guardedCall(
						entry,
						phase,
						timeouts.hook,
						scope,
						input,
						() => (hook as HookFn).apply(hooks, args),
					);
				} catch (error) {
					if (input.hookErrorMode === "throw") throw error;
					return undefined;
				}
			};
		}
		return wrapped as ExtensionHooks;
	}

	private wrapTool(
		entry: PluginEntry,
		instance: PluginInstance,
		tool: AgentTool,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentTool {
		const phase: PluginErrorPhase = `tool:${tool.name}`;
		return {
			...tool,
			execute: async (toolInput: unknown, context: AgentToolContext) => {
				this.assertUsable(entry, instance, `tool "${tool.name}"`);
				return this.guardedCall(
					entry,
					phase,
					tool.timeoutMs ?? timeouts.call,
					scope,
					input,
					() =>
						tool.execute(toolInput, {
							...context,
							cwd: context.cwd ?? input.cwd,
							emitEvent: context.emitEvent ?? scope.emitEvent,
						}),
					// A cancelled run is not the plugin's fault.
					() => context.signal?.aborted === true,
				);
			},
		};
	}

	private wrapCommand(
		entry: PluginEntry,
		instance: PluginInstance,
		command: AgentExtensionCommand,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionCommand {
		const handler = command.handler;
		if (typeof handler !== "function") return command;
		return {
			...command,
			handler: async (commandInput: string) => {
				this.assertUsable(entry, instance, `command "/${command.name}"`);
				return this.guardedCall(
					entry,
					`command:${command.name}`,
					timeouts.call,
					scope,
					input,
					() => handler.call(command, commandInput),
				);
			},
		};
	}

	/** A failing rule contributes no text rather than breaking the prompt. */
	private wrapRule(
		entry: PluginEntry,
		instance: PluginInstance,
		rule: AgentExtensionRule,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionRule {
		const content = rule.content;
		if (typeof content !== "function") return rule;
		return {
			...rule,
			content: async () => {
				if (!this.isUsable(entry, instance)) return "";
				try {
					return await this.guardedCall(
						entry,
						`rule:${rule.id}`,
						timeouts.call,
						scope,
						input,
						() => content.call(rule),
					);
				} catch {
					return "";
				}
			},
		};
	}

	/** A failing builder leaves the message unchanged. */
	private wrapMessageBuilder(
		entry: PluginEntry,
		instance: PluginInstance,
		builder: AgentExtensionMessageBuilder<Message[]>,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		timeouts: PluginTimeouts,
	): AgentExtensionMessageBuilder<Message[]> {
		return {
			...builder,
			build: async (messages) => {
				if (!this.isUsable(entry, instance)) return messages;
				try {
					return await this.guardedCall(
						entry,
						`messageBuilder:${builder.name}`,
						timeouts.call,
						scope,
						input,
						() => builder.build.call(builder, messages),
					);
				} catch {
					return messages;
				}
			},
		};
	}

	/**
	 * Runs one plugin call in its session scope with a timeout, records the
	 * outcome against the plugin, and rethrows failures.
	 */
	private async guardedCall<T>(
		entry: PluginEntry,
		phase: PluginErrorPhase,
		timeoutMs: number,
		scope: PluginCallScope,
		input: PluginSessionLoadInput,
		call: () => T | Promise<T>,
		isCancelled?: () => boolean,
	): Promise<T> {
		const startedAt = Date.now();
		try {
			const result = await runWithTimeout(
				() => runInPluginScope(scope, call),
				timeoutMs,
				`Plugin "${entry.name}" ${phase}`,
			);
			entry.consecutiveFailures = 0;
			this.warnIfSlow(entry, phase, startedAt, timeoutMs, input);
			return result;
		} catch (error) {
			if (!isCancelled?.()) {
				this.recordFailure(entry, phase, error, {
					sessionId: input.sessionId,
				});
			}
			throw error;
		}
	}

	/**
	 * Whether a session's copy may still be called: the plugin is not turned
	 * off, its setup did not fail, and its session has not ended.
	 */
	private isUsable(entry: PluginEntry, instance: PluginInstance): boolean {
		return !entry.blocked && !instance.setupFailed && !instance.closed;
	}

	private assertUsable(
		entry: PluginEntry,
		instance: PluginInstance,
		what: string,
	): void {
		if (this.isUsable(entry, instance)) return;
		const reason = instance.closed
			? "its session ended"
			: entry.lastError
				? `${entry.lastError.phase}: ${entry.lastError.message}`
				: "it is turned off";
		throw new Error(
			`Plugin "${entry.name}" ${what} is unavailable (${reason})`,
		);
	}

	private async releaseInstance(
		entry: PluginEntry,
		instance: PluginInstance,
		sessionId: string | undefined,
		timeouts: PluginTimeouts,
	): Promise<void> {
		if (instance.closed) return;
		instance.closed = true;
		if (sessionId) entry.sessions.delete(sessionId);
		const scope: PluginCallScope = { sessionId, pluginName: entry.name };
		for (const cleanup of instance.disposers.splice(0).reverse()) {
			try {
				await runWithTimeout(
					() => runInPluginScope(scope, cleanup),
					timeouts.hook,
					`Plugin "${entry.name}" dispose`,
				);
			} catch (error) {
				// Log only: a cleanup failure must not change the status that
				// other sessions rely on.
				const { message, stack } = toErrorParts(error);
				this.log("warn", "plugin.error", entry, {
					phase: "dispose",
					sessionId,
					errorMessage: message,
					stack,
				});
			}
		}
	}

	private recordFailure(
		entry: PluginEntry,
		phase: PluginErrorPhase,
		error: unknown,
		options: {
			/** Turn the plugin off for every session. */
			fatal?: boolean;
			/** Force this state without blocking (per-session setup failure). */
			state?: PluginRuntimeState;
			sessionId?: string;
			messagePrefix?: string;
			/** Tell the calling session even if the state did not change. */
			notify?: (issue: SessionPluginIssue) => void;
		},
	): void {
		const { message, stack } = toErrorParts(error);
		const timedOut = error instanceof PluginCallTimeoutError;
		this.log("warn", "plugin.error", entry, {
			phase,
			sessionId: options.sessionId,
			errorMessage: message,
			timedOut,
			stack,
		});
		entry.errorCount += 1;
		if (timedOut) entry.timeoutCount += 1;
		entry.consecutiveFailures += 1;
		entry.lastError = {
			phase,
			message: `${options.messagePrefix ?? ""}${message}`,
			...(stack ? { stack } : {}),
			pluginPath: entry.pluginPath,
			timestamp: Date.now(),
			...(options.sessionId ? { sessionId: options.sessionId } : {}),
			...(timedOut ? { timedOut } : {}),
		};
		const block =
			options.fatal === true ||
			(!options.state && entry.consecutiveFailures >= this.failureThreshold);
		const next: PluginRuntimeState = block
			? "failed"
			: (options.state ?? "degraded");
		// Sessions are told when the plugin is turned off even if the state
		// already read `failed` from a per-session setup failure.
		const changed = entry.state !== next || (block && !entry.blocked);
		if (block) {
			entry.blocked = true;
			entry.extension = undefined;
			entry.spare = undefined;
		}
		this.setState(entry, next, true);
		const issue = this.toIssue(entry, "error");
		// A per-session failure (setup) concerns only the calling session;
		// other sessions' copies still work, so do not tell them otherwise.
		const notified: Array<(issue: SessionPluginIssue) => void> = [];
		if (changed && !options.state) {
			for (const onIssue of entry.sessions.values()) {
				if (onIssue) notified.push(onIssue);
			}
		}
		if (options.notify && !notified.includes(options.notify)) {
			notified.push(options.notify);
		}
		for (const onIssue of notified) {
			try {
				onIssue(issue);
			} catch {
				// Reporting must never turn into a second failure.
			}
		}
	}

	private setState(
		entry: PluginEntry,
		state: PluginRuntimeState,
		forceNotify = false,
	): void {
		const changed = entry.state !== state;
		entry.state = state;
		entry.updatedAt = Date.now();
		if (!changed && !forceNotify) return;
		const status = this.toStatus(entry);
		for (const listener of this.listeners) {
			try {
				listener(status);
			} catch {
				// A broken listener must not break plugin status tracking.
			}
		}
	}

	private warnIfSlow(
		entry: PluginEntry,
		phase: string,
		startedAt: number,
		limitMs: number,
		input: PluginSessionLoadInput,
	): void {
		// A synchronous plugin call blocks the event loop, so its timeout can
		// only be observed after it returns. Log it once it does.
		const elapsedMs = Date.now() - startedAt;
		if (elapsedMs <= limitMs) return;
		this.log("warn", "plugin.call.slow", entry, {
			phase,
			sessionId: input.sessionId,
			elapsedMs,
			limitMs,
		});
	}

	private log(
		level: "info" | "warn",
		event: string,
		entry: PluginEntry,
		fields: Record<string, unknown>,
	): void {
		const metadata = {
			event,
			pluginName: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			...fields,
		};
		if (level === "info") {
			this.logger?.debug?.(`[plugins] ${event} ${entry.name}`, metadata);
			return;
		}
		const detail = typeof fields.phase === "string" ? ` (${fields.phase})` : "";
		const message =
			typeof fields.errorMessage === "string" ? `: ${fields.errorMessage}` : "";
		this.logger?.log(`[plugins] ${event} ${entry.name}${detail}${message}`, {
			severity: "warn",
			...metadata,
		});
	}

	private toStatus(entry: PluginEntry): PluginStatusRecord {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			...(entry.lastError ? { lastError: { ...entry.lastError } } : {}),
			errorCount: entry.errorCount,
			timeoutCount: entry.timeoutCount,
			sessionIds: [...entry.sessions.keys()].sort(),
			...(entry.extension
				? {
						capabilities: [...entry.extension.manifest.capabilities].sort(),
						hooks: Object.keys(entry.extension.hooks ?? {}).sort(),
					}
				: {}),
			updatedAt: entry.updatedAt,
		};
	}

	private toIssue(
		entry: PluginEntry,
		reason: SessionPluginIssue["reason"],
	): SessionPluginIssue {
		return {
			name: entry.name,
			pluginPath: entry.pluginPath,
			state: entry.state,
			reason,
			...(entry.lastError ? { lastError: { ...entry.lastError } } : {}),
		};
	}

	private toInitializationFailure(
		entry: PluginEntry,
	): PluginInitializationFailure {
		return {
			pluginPath: entry.pluginPath,
			pluginName: entry.name,
			phase: entry.lastError?.phase === "setup" ? "setup" : "load",
			message: entry.lastError?.message ?? `Plugin is ${entry.state}`,
			stack: entry.lastError?.stack,
		};
	}
}

/** One-line, user-facing description of a plugin a session cannot fully use. */
export function formatSessionPluginIssue(issue: SessionPluginIssue): string {
	const phase = issue.lastError?.phase;
	const message = issue.lastError?.message ?? "unknown error";
	if (issue.state === "degraded") {
		return `Plugin "${issue.name}" ${phase ?? "call"} failed: ${message}. The plugin is still active; repeated failures will turn it off.`;
	}
	if (issue.state === "disabled") {
		return `Plugin "${issue.name}" is disabled${issue.reason === "session_policy" ? " for this session" : " in settings"}.`;
	}
	const where =
		phase === "uncaught"
			? " with an uncaught error"
			: phase
				? ` during ${phase}`
				: "";
	return `Plugin "${issue.name}" failed${where}: ${message} (${issue.pluginPath}). Its tools and hooks are unavailable.`;
}

let processPluginRegistry: PluginRegistry | undefined;

/**
 * The registry shared by every session in this process. The Hub daemon reads
 * it for `plugins.*` requests and to attribute stray plugin errors.
 */
export function getProcessPluginRegistry(): PluginRegistry {
	processPluginRegistry ??= new PluginRegistry();
	return processPluginRegistry;
}

/** @internal Test hook. */
export function resetProcessPluginRegistryForTests(
	registry?: PluginRegistry,
): void {
	processPluginRegistry = registry;
}
