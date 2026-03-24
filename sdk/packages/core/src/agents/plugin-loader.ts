import { existsSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "@clinebot/agents";
import createJiti from "jiti";

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
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ALIASES = collectWorkspaceAliases(MODULE_DIR);
const BUILTIN_MODULES = new Set(
	builtinModules.flatMap((id) => [id, id.replace(/^node:/, "")]),
);

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

function collectWorkspaceAliases(startDir: string): Record<string, string> {
	const root = resolve(startDir, "..", "..", "..", "..");
	const aliases: Record<string, string> = {};
	const candidates: Record<string, string> = {
		"@clinebot/agents": resolve(root, "packages/agents/src/index.ts"),
		"@clinebot/core": resolve(root, "packages/core/src/index.node.ts"),
		"@clinebot/llms": resolve(root, "packages/llms/src/index.ts"),
		"@clinebot/rpc": resolve(root, "packages/rpc/src/index.ts"),
		"@clinebot/scheduler": resolve(root, "packages/scheduler/src/index.ts"),
		"@clinebot/shared": resolve(root, "packages/shared/src/index.ts"),
		"@clinebot/shared/storage": resolve(
			root,
			"packages/shared/src/storage/index.ts",
		),
		"@clinebot/shared/db": resolve(root, "packages/shared/src/db/index.ts"),
	};
	for (const [key, value] of Object.entries(candidates)) {
		if (existsSync(value)) {
			aliases[key] = value;
		}
	}
	return aliases;
}

function collectPluginImportAliases(
	pluginPath: string,
): Record<string, string> {
	const pluginRequire = createRequire(pluginPath);
	const aliases: Record<string, string> = {};
	for (const [specifier, sourcePath] of Object.entries(WORKSPACE_ALIASES)) {
		try {
			pluginRequire.resolve(specifier);
			continue;
		} catch {
			// Use the workspace source only when the plugin package does not provide
			// its own installed SDK dependency.
		}
		aliases[specifier] = sourcePath;
	}
	return aliases;
}

async function importPluginModule(
	absolutePath: string,
): Promise<Record<string, unknown>> {
	const aliases = collectPluginImportAliases(absolutePath);
	const jiti = createJiti(absolutePath, {
		alias: aliases,
		cache: false,
		requireCache: false,
		esmResolve: true,
		interopDefault: false,
		nativeModules: [...BUILTIN_MODULES],
		transformModules: Object.keys(aliases),
	});
	return (await jiti.import(absolutePath, {})) as Record<string, unknown>;
}

export async function loadAgentPluginFromPath(
	pluginPath: string,
	options: LoadAgentPluginFromPathOptions = {},
): Promise<AgentPlugin> {
	const absolutePath = resolve(options.cwd ?? process.cwd(), pluginPath);
	const moduleExports = await importPluginModule(absolutePath);
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
