import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentConfig, AgentTool, ITelemetryService } from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import { z } from "zod";
import { captureTelemetryOptOut } from "./telemetry/core-events";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];

const GlobalSettingsStringListSchema = z
	.preprocess(
		(value) =>
			Array.isArray(value)
				? value
						.filter((entry): entry is string => typeof entry === "string")
						.map((entry) => entry.trim())
						.filter(Boolean)
				: undefined,
		z.array(z.string()).optional(),
	)
	.transform((entries) => {
		if (!entries) {
			return undefined;
		}
		const normalized = [...new Set(entries)].sort((left, right) =>
			left.localeCompare(right),
		);
		return normalized.length > 0 ? normalized : undefined;
	});

const GlobalCompactionStrategySchema = z
	.enum(["basic", "agentic"])
	.catch("agentic");

export type GlobalCompactionStrategy = z.infer<
	typeof GlobalCompactionStrategySchema
>;

/** Compaction strategy plus the "off" state surfaced by the CLI settings UI. */
export type GlobalCompactionMode = GlobalCompactionStrategy | "off";

const GlobalPlanActModeSchema = z.enum(["plan", "act"]);

export type GlobalPlanActMode = z.infer<typeof GlobalPlanActModeSchema>;

export const GlobalSettingsSchema = z
	.object({
		telemetryOptOut: z.boolean().default(false).catch(false),
		autoUpdateEnabled: z.boolean().default(true).catch(true),
		compactionStrategy: GlobalCompactionStrategySchema.optional(),
		compactionEnabled: z.boolean().optional().catch(undefined),
		planActMode: GlobalPlanActModeSchema.optional().catch(undefined),
		toolAutoApprove: z.boolean().optional().catch(undefined),
		disabledTools: GlobalSettingsStringListSchema.optional(),
		disabledPlugins: GlobalSettingsStringListSchema.optional(),
	})
	.strip()
	.transform((settings) => {
		const normalized: {
			telemetryOptOut: boolean;
			autoUpdateEnabled: boolean;
			compactionStrategy?: GlobalCompactionStrategy;
			compactionEnabled?: boolean;
			planActMode?: GlobalPlanActMode;
			toolAutoApprove?: boolean;
			disabledTools?: string[];
			disabledPlugins?: string[];
		} = {
			autoUpdateEnabled: settings.autoUpdateEnabled,
			telemetryOptOut: settings.telemetryOptOut,
		};
		if (settings.compactionStrategy) {
			normalized.compactionStrategy = settings.compactionStrategy;
		}
		if (settings.compactionEnabled !== undefined) {
			normalized.compactionEnabled = settings.compactionEnabled;
		}
		if (settings.planActMode) {
			normalized.planActMode = settings.planActMode;
		}
		if (settings.toolAutoApprove !== undefined) {
			normalized.toolAutoApprove = settings.toolAutoApprove;
		}
		if (settings.disabledTools?.length) {
			normalized.disabledTools = settings.disabledTools;
		}
		if (settings.disabledPlugins?.length) {
			normalized.disabledPlugins = settings.disabledPlugins;
		}
		return normalized;
	});

export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;

export interface WriteGlobalSettingsOptions {
	telemetry?: ITelemetryService;
}

function defaultGlobalSettings(): GlobalSettings {
	return GlobalSettingsSchema.parse({});
}

interface CachedSettings {
	path: string;
	mtimeMs: number;
	size: number;
	value: GlobalSettings;
}

let settingsCache: CachedSettings | undefined;

function invalidateSettingsCache(): void {
	settingsCache = undefined;
}

function freezeSettings(value: GlobalSettings): GlobalSettings {
	if (value.disabledTools) {
		Object.freeze(value.disabledTools);
	}
	if (value.disabledPlugins) {
		Object.freeze(value.disabledPlugins);
	}
	return Object.freeze(value);
}

function loadSettingsFromDisk(filePath: string): GlobalSettings {
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return defaultGlobalSettings();
	}
	try {
		const result = GlobalSettingsSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : defaultGlobalSettings();
	} catch {
		return defaultGlobalSettings();
	}
}

function getCachedSettings(): CachedSettings {
	const filePath = resolveGlobalSettingsPath();
	const stats = statSync(filePath, { throwIfNoEntry: false });
	const mtimeMs = stats?.mtimeMs ?? 0;
	const size = stats?.size ?? 0;

	const cached = settingsCache;
	if (
		cached &&
		cached.path === filePath &&
		cached.mtimeMs === mtimeMs &&
		cached.size === size
	) {
		return cached;
	}

	const value = freezeSettings(
		stats ? loadSettingsFromDisk(filePath) : defaultGlobalSettings(),
	);
	settingsCache = { path: filePath, mtimeMs, size, value };
	return settingsCache;
}

export function readGlobalSettings(): GlobalSettings {
	return getCachedSettings().value;
}

// The settings file is shared across hosts (CLI instances, VS Code, the hub
// daemon). Updates take a short-lived lock file so concurrent read-modify-write
// cycles do not silently discard each other's changes, and the file itself is
// replaced atomically so readers never observe a torn write.
const SETTINGS_LOCK_STALE_MS = 2_000;
const SETTINGS_LOCK_TIMEOUT_MS = 250;
const SETTINGS_LOCK_RETRY_DELAY_MS = 5;

let tmpFileCounter = 0;

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireSettingsLock(filePath: string): (() => void) | undefined {
	const lockPath = `${filePath}.lock`;
	const deadline = Date.now() + SETTINGS_LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			writeFileSync(lockPath, String(process.pid), { flag: "wx" });
			return () => {
				try {
					rmSync(lockPath, { force: true });
				} catch {
					// Best effort: a leftover lock is reclaimed as stale.
				}
			};
		} catch {
			const lockMtimeMs = statSync(lockPath, {
				throwIfNoEntry: false,
			})?.mtimeMs;
			if (
				lockMtimeMs !== undefined &&
				Date.now() - lockMtimeMs > SETTINGS_LOCK_STALE_MS
			) {
				try {
					rmSync(lockPath, { force: true });
				} catch {
					// Another process may have reclaimed it first.
				}
				continue;
			}
			if (Date.now() >= deadline) {
				// Never block a user-facing settings write indefinitely: fall
				// back to an unlocked write after the bounded wait.
				return undefined;
			}
			sleepSync(SETTINGS_LOCK_RETRY_DELAY_MS);
		}
	}
}

function writeSettingsFileAtomically(
	filePath: string,
	normalized: GlobalSettings,
): void {
	const tmpPath = `${filePath}.${process.pid}.${tmpFileCounter++}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	renameSync(tmpPath, filePath);
}

/**
 * Cross-process-safe read-modify-write: re-reads the latest on-disk settings
 * while holding the settings lock, applies the mutation, and writes the result
 * atomically. All targeted setters route through this so concurrent hosts
 * cannot clobber each other's unrelated changes.
 */
export function updateGlobalSettings(
	mutate: (current: GlobalSettings) => z.input<typeof GlobalSettingsSchema>,
	options: WriteGlobalSettingsOptions = {},
): GlobalSettings {
	const filePath = resolveGlobalSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	const release = acquireSettingsLock(filePath);
	try {
		invalidateSettingsCache();
		const previous = readGlobalSettings();
		const normalized = GlobalSettingsSchema.parse(mutate(previous));
		if (!previous.telemetryOptOut && normalized.telemetryOptOut) {
			captureTelemetryOptOut(options.telemetry);
		}
		writeSettingsFileAtomically(filePath, normalized);
		return normalized;
	} finally {
		invalidateSettingsCache();
		release?.();
	}
}

export function writeGlobalSettings(
	settings: z.input<typeof GlobalSettingsSchema>,
	options: WriteGlobalSettingsOptions = {},
): void {
	updateGlobalSettings(() => settings, options);
}

export function isTelemetryOptedOutGlobally(): boolean {
	return readGlobalSettings().telemetryOptOut;
}

export function setTelemetryOptOutGlobally(
	telemetryOptOut: boolean,
	options: WriteGlobalSettingsOptions = {},
): void {
	updateGlobalSettings((current) => ({ ...current, telemetryOptOut }), options);
}

export function isAutoUpdateEnabledGlobally(): boolean {
	return readGlobalSettings().autoUpdateEnabled;
}

export function setAutoUpdateEnabledGlobally(
	autoUpdateEnabled: boolean,
	options: WriteGlobalSettingsOptions = {},
): void {
	updateGlobalSettings(
		(current) => ({ ...current, autoUpdateEnabled }),
		options,
	);
}

export function readCompactionStrategyGlobally(): GlobalCompactionStrategy {
	return readGlobalSettings().compactionStrategy ?? "agentic";
}

export function setCompactionStrategyGlobally(
	compactionStrategy: GlobalCompactionStrategy,
): void {
	updateGlobalSettings((current) => ({ ...current, compactionStrategy }));
}

/**
 * Returns the persisted compaction mode including the disabled state, or
 * undefined when the user never chose one (callers apply their own default).
 */
export function readCompactionModeGlobally(): GlobalCompactionMode | undefined {
	const settings = readGlobalSettings();
	if (settings.compactionEnabled === false) {
		return "off";
	}
	return settings.compactionStrategy;
}

/**
 * Persists the full compaction mode. Selecting "off" keeps the previously
 * chosen strategy so re-enabling compaction restores it.
 */
export function setCompactionModeGlobally(mode: GlobalCompactionMode): void {
	updateGlobalSettings((current) =>
		mode === "off"
			? { ...current, compactionEnabled: false }
			: { ...current, compactionEnabled: true, compactionStrategy: mode },
	);
}

export function readPlanActModeGlobally(): GlobalPlanActMode | undefined {
	return readGlobalSettings().planActMode;
}

export function setPlanActModeGlobally(planActMode: GlobalPlanActMode): void {
	updateGlobalSettings((current) => ({ ...current, planActMode }));
}

export function readToolAutoApproveGlobally(): boolean | undefined {
	return readGlobalSettings().toolAutoApprove;
}

export function setToolAutoApproveGlobally(toolAutoApprove: boolean): void {
	updateGlobalSettings((current) => ({ ...current, toolAutoApprove }));
}

export function resolveDisabledToolNames(
	disabledToolNames?: ReadonlyArray<string>,
): Set<string> {
	return new Set(disabledToolNames ?? readGlobalSettings().disabledTools ?? []);
}

export function resolveDisabledPluginPaths(
	disabledPluginPaths?: ReadonlyArray<string>,
): Set<string> {
	return new Set(
		disabledPluginPaths ?? readGlobalSettings().disabledPlugins ?? [],
	);
}

export function isToolDisabledGlobally(toolName: string): boolean {
	return resolveDisabledToolNames().has(toolName);
}

export function toggleDisabledTool(toolName: string): boolean {
	let nowDisabled = false;
	updateGlobalSettings((current) => {
		const disabled = new Set(current.disabledTools ?? []);
		nowDisabled = !disabled.has(toolName);
		if (nowDisabled) {
			disabled.add(toolName);
		} else {
			disabled.delete(toolName);
		}
		return { ...current, disabledTools: [...disabled] };
	});
	return nowDisabled;
}

export function setDisabledTools(
	toolNames: ReadonlyArray<string>,
	disabledValue: boolean,
): void {
	const names = [
		...new Set(toolNames.map((name) => name.trim()).filter(Boolean)),
	];
	if (names.length === 0) {
		return;
	}

	updateGlobalSettings((current) => {
		const disabled = new Set(current.disabledTools ?? []);
		for (const name of names) {
			if (disabledValue) {
				disabled.add(name);
			} else {
				disabled.delete(name);
			}
		}
		return { ...current, disabledTools: [...disabled] };
	});
}

export function setToolDisabledGlobally(
	toolName: string,
	disabled: boolean,
): boolean {
	setDisabledTools([toolName], disabled);
	return disabled;
}

export function isPluginDisabledGlobally(pluginPath: string): boolean {
	return resolveDisabledPluginPaths().has(pluginPath);
}

export function setDisabledPlugin(
	pluginPath: string,
	disabledValue: boolean,
): void {
	const path = pluginPath.trim();
	if (!path) {
		return;
	}

	updateGlobalSettings((current) => {
		const disabled = new Set(current.disabledPlugins ?? []);
		if (disabledValue) {
			disabled.add(path);
		} else {
			disabled.delete(path);
		}
		return { ...current, disabledPlugins: [...disabled] };
	});
}

export function filterDisabledPluginPaths(
	pluginPaths: ReadonlyArray<string>,
	disabledPluginPaths?: ReadonlyArray<string>,
): string[] {
	const disabled = resolveDisabledPluginPaths(disabledPluginPaths);
	if (disabled.size === 0) {
		return [...pluginPaths];
	}
	return pluginPaths.filter((pluginPath) => !disabled.has(pluginPath));
}

export function filterDisabledTools<T extends Pick<AgentTool, "name">>(
	tools: ReadonlyArray<T>,
	disabledToolNames?: ReadonlyArray<string>,
): T[] {
	const disabled = resolveDisabledToolNames(disabledToolNames);
	if (disabled.size === 0) {
		return [...tools];
	}
	return tools.filter((tool) => !disabled.has(tool.name));
}

export function filterExtensionToolRegistrations(
	extensions: AgentConfig["extensions"],
	disabledToolNames?: ReadonlyArray<string>,
): AgentConfig["extensions"] {
	if (!extensions || extensions.length === 0) {
		return extensions;
	}

	const disabled = resolveDisabledToolNames(disabledToolNames);
	if (disabled.size === 0) {
		return extensions;
	}

	return extensions.map((extension) => {
		if (!extension.setup) {
			return extension;
		}

		return {
			...extension,
			setup: (api: AgentExtensionApi, ctx) =>
				extension.setup?.(
					{
						...api,
						registerTool: (tool) => {
							if (!disabled.has(tool.name)) {
								api.registerTool(tool);
							}
						},
					},
					ctx,
				),
		};
	});
}
