import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentConfig, AgentTool } from "@clinebot/shared";
import { resolveGlobalSettingsPath } from "@clinebot/shared/storage";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];

export interface GlobalSettings {
	disabledTools?: string[];
	disabledPlugins?: string[];
}

function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const normalized = [
		...new Set(
			value
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	].sort((left, right) => left.localeCompare(right));

	return normalized.length > 0 ? normalized : undefined;
}

const normalizeDisabledTools = normalizeStringList;
const normalizeDisabledPlugins = normalizeStringList;

export function readGlobalSettings(): GlobalSettings {
	const filePath = resolveGlobalSettingsPath();
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as GlobalSettings;
		return {
			disabledTools: normalizeDisabledTools(parsed.disabledTools),
			disabledPlugins: normalizeDisabledPlugins(parsed.disabledPlugins),
		};
	} catch {
		return {};
	}
}

export function writeGlobalSettings(settings: GlobalSettings): void {
	const filePath = resolveGlobalSettingsPath();
	mkdirSync(dirname(filePath), { recursive: true });
	const normalizedDisabledTools = normalizeDisabledTools(
		settings.disabledTools,
	);
	const normalizedDisabledPlugins = normalizeDisabledPlugins(
		settings.disabledPlugins,
	);
	const normalized: GlobalSettings = {};
	if (normalizedDisabledTools) {
		normalized.disabledTools = normalizedDisabledTools;
	}
	if (normalizedDisabledPlugins) {
		normalized.disabledPlugins = normalizedDisabledPlugins;
	}
	writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
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
