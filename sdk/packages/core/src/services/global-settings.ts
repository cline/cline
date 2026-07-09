import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
	.catch("basic");

export type GlobalCompactionStrategy = z.infer<
	typeof GlobalCompactionStrategySchema
>;

export const GlobalSettingsSchema = z
	.object({
		telemetryOptOut: z.boolean().default(false).catch(false),
		autoUpdateEnabled: z.boolean().default(true).catch(true),
		compactionStrategy: GlobalCompactionStrategySchema.optional(),
		disabledTools: GlobalSettingsStringListSchema.optional(),
		disabledPlugins: GlobalSettingsStringListSchema.optional(),
	})
	.strip()
	.transform((settings) => {
		const normalized: {
			telemetryOptOut: boolean;
			autoUpdateEnabled: boolean;
			compactionStrategy?: GlobalCompactionStrategy;
			disabledTools?: string[];
			disabledPlugins?: string[];
		} = {
			autoUpdateEnabled: settings.autoUpdateEnabled,
			telemetryOptOut: settings.telemetryOptOut,
		};
		if (settings.compactionStrategy) {
			normalized.compactionStrategy = settings.compactionStrategy;
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

export function writeGlobalSettings(
	settings: z.input<typeof GlobalSettingsSchema>,
	options: WriteGlobalSettingsOptions = {},
): void {
	const filePath = resolveGlobalSettingsPath();
	const previous = readGlobalSettings();
	mkdirSync(dirname(filePath), { recursive: true });
	const normalized = GlobalSettingsSchema.parse(settings);
	if (!previous.telemetryOptOut && normalized.telemetryOptOut) {
		captureTelemetryOptOut(options.telemetry);
	}
	writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	invalidateSettingsCache();
}

export function isTelemetryOptedOutGlobally(): boolean {
	return readGlobalSettings().telemetryOptOut;
}

export function setTelemetryOptOutGlobally(
	telemetryOptOut: boolean,
	options: WriteGlobalSettingsOptions = {},
): void {
	writeGlobalSettings(
		{
			...readGlobalSettings(),
			telemetryOptOut,
		},
		options,
	);
}

export function isAutoUpdateEnabledGlobally(): boolean {
	return readGlobalSettings().autoUpdateEnabled;
}

export function setAutoUpdateEnabledGlobally(
	autoUpdateEnabled: boolean,
	options: WriteGlobalSettingsOptions = {},
): void {
	writeGlobalSettings(
		{
			...readGlobalSettings(),
			autoUpdateEnabled,
		},
		options,
	);
}

export function readCompactionStrategyGlobally(): GlobalCompactionStrategy {
	return readGlobalSettings().compactionStrategy ?? "basic";
}

export function setCompactionStrategyGlobally(
	compactionStrategy: GlobalCompactionStrategy,
): void {
	writeGlobalSettings({ ...readGlobalSettings(), compactionStrategy });
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
	const settings = readGlobalSettings();
	const disabled = new Set(settings.disabledTools ?? []);
	const wasDisabled = disabled.has(toolName);
	if (wasDisabled) {
		disabled.delete(toolName);
	} else {
		disabled.add(toolName);
	}
	writeGlobalSettings({ ...settings, disabledTools: [...disabled] });
	return !wasDisabled;
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

	const settings = readGlobalSettings();
	const disabled = resolveDisabledToolNames(settings.disabledTools);
	for (const name of names) {
		if (disabledValue) {
			disabled.add(name);
		} else {
			disabled.delete(name);
		}
	}
	writeGlobalSettings({ ...settings, disabledTools: [...disabled] });
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

	const settings = readGlobalSettings();
	const disabled = resolveDisabledPluginPaths(settings.disabledPlugins);
	if (disabledValue) {
		disabled.add(path);
	} else {
		disabled.delete(path);
	}
	writeGlobalSettings({ ...settings, disabledPlugins: [...disabled] });
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
