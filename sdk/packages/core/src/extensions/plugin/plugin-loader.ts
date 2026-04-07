import { resolve } from "node:path";
import type { AgentConfig } from "@clinebot/agents";
import { importPluginModule } from "./plugin-module-import";

type AgentPlugin = NonNullable<AgentConfig["extensions"]>[number];
type PluginLike = {
	name: string;
	manifest: {
		capabilities: string[];
		hookStages?: string[];
	};
};

export interface LoadAgentPluginFromPathOptions {
	exportName?: string;
	cwd?: string;
	useCache?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasValidStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function validatePluginManifest(
	plugin: PluginLike,
	absolutePath: string,
): void {
	if (!isObject(plugin.manifest)) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: missing required "manifest"`,
		);
	}
	if (!hasValidStringArray(plugin.manifest.capabilities)) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: manifest.capabilities must be a string array`,
		);
	}
	if (plugin.manifest.capabilities.length === 0) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: manifest.capabilities cannot be empty`,
		);
	}
	if (
		Object.hasOwn(plugin.manifest, "hookStages") &&
		!hasValidStringArray(plugin.manifest.hookStages)
	) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: manifest.hookStages must be a string array when provided`,
		);
	}
}

function validatePluginExport(
	plugin: unknown,
	absolutePath: string,
): asserts plugin is PluginLike {
	if (!isObject(plugin)) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: expected object export`,
		);
	}
	if (typeof plugin.name !== "string" || plugin.name.length === 0) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: expected non-empty "name"`,
		);
	}
	if (!Object.hasOwn(plugin, "manifest")) {
		throw new Error(
			`Invalid plugin module at ${absolutePath}: missing required "manifest"`,
		);
	}
	validatePluginManifest(plugin as PluginLike, absolutePath);
}

export async function loadAgentPluginFromPath(
	pluginPath: string,
	options: LoadAgentPluginFromPathOptions = {},
): Promise<AgentPlugin> {
	const absolutePath = resolve(options.cwd ?? process.cwd(), pluginPath);
	const moduleExports = await importPluginModule(absolutePath, {
		useCache: options.useCache,
	});
	const exportName = options.exportName ?? "plugin";
	const plugin = (moduleExports.default ??
		moduleExports[exportName]) as unknown;

	validatePluginExport(plugin, absolutePath);
	return plugin as AgentPlugin;
}

export async function loadAgentPluginsFromPaths(
	pluginPaths: string[],
	options: LoadAgentPluginFromPathOptions = {},
): Promise<AgentPlugin[]> {
	const loaded: AgentPlugin[] = [];
	for (const pluginPath of pluginPaths) {
		loaded.push(await loadAgentPluginFromPath(pluginPath, options));
	}
	return loaded;
}
