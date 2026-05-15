import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export const GlobalSettingsSchema = z
	.object({
		telemetryOptOut: z.boolean().default(false).catch(false),
		disabledTools: GlobalSettingsStringListSchema.optional(),
		disabledPlugins: GlobalSettingsStringListSchema.optional(),
	})
	.strip()
	.transform((settings) => {
		const normalized: {
			telemetryOptOut: boolean;
			disabledTools?: string[];
			disabledPlugins?: string[];
		} = {
			telemetryOptOut: settings.telemetryOptOut,
		};
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

export function readGlobalSettings(): GlobalSettings {
	const filePath = resolveGlobalSettingsPath();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return defaultGlobalSettings();
	}
	const result = GlobalSettingsSchema.safeParse(parsed);
	return result.success ? result.data : defaultGlobalSettings();
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
	const disabled = resolveDisabledToolNames();
	const settings = readGlobalSettings();
	if (disabled.has(toolName)) {
		disabled.delete(toolName);
		writeGlobalSettings({ ...settings, disabledTools: [...disabled] });
		return false;
	}

	disabled.add(toolName);
	writeGlobalSettings({ ...settings, disabledTools: [...disabled] });
	return true;
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
