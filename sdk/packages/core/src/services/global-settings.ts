import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentConfig, Tool } from "@clinebot/shared";
import { resolveGlobalSettingsPath } from "@clinebot/shared/storage";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];

export interface GlobalSettings {
	disabledTools?: string[];
}

function normalizeDisabledTools(value: unknown): string[] | undefined {
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

export function readGlobalSettings(): GlobalSettings {
	const filePath = resolveGlobalSettingsPath();
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as GlobalSettings;
		return {
			disabledTools: normalizeDisabledTools(parsed.disabledTools),
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
	const normalized: GlobalSettings = normalizedDisabledTools
		? { disabledTools: normalizedDisabledTools }
		: {};
	writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function resolveDisabledToolNames(
	disabledToolNames?: ReadonlyArray<string>,
): Set<string> {
	return new Set(disabledToolNames ?? readGlobalSettings().disabledTools ?? []);
}

export function isToolDisabledGlobally(toolName: string): boolean {
	return resolveDisabledToolNames().has(toolName);
}

export function toggleDisabledTool(toolName: string): boolean {
	const disabled = resolveDisabledToolNames();
	if (disabled.has(toolName)) {
		disabled.delete(toolName);
		writeGlobalSettings({ disabledTools: [...disabled] });
		return false;
	}

	disabled.add(toolName);
	writeGlobalSettings({ disabledTools: [...disabled] });
	return true;
}

export function filterDisabledTools<T extends Pick<Tool, "name">>(
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
			setup: (api: AgentExtensionApi) =>
				extension.setup?.({
					...api,
					registerTool: (tool) => {
						if (!disabled.has(tool.name)) {
							api.registerTool(tool);
						}
					},
				}),
		};
	});
}
