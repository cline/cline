import path from "node:path";
import type { RemoteConfigManagedPaths } from "./bundle";

export const DEFAULT_REMOTE_CONFIG_PLUGIN_NAME = "remote-config";

export function resolveRemoteConfigPaths(input: {
	workspacePath: string;
	pluginName?: string;
}): RemoteConfigManagedPaths {
	const pluginName = input.pluginName ?? DEFAULT_REMOTE_CONFIG_PLUGIN_NAME;
	const pluginPath = path.join(input.workspacePath, ".cline", pluginName);
	return {
		pluginName,
		pluginPath,
		workflowsPath: path.join(pluginPath, "workflows"),
		skillsPath: path.join(pluginPath, "skills"),
		bundleCachePath: path.join(pluginPath, "cache", "bundle.json"),
		manifestPath: path.join(pluginPath, "managed.json"),
		rulesFilePath: path.join(pluginPath, "rules.md"),
	};
}

export function getRemoteConfigCommandDirectories(
	paths: RemoteConfigManagedPaths,
): {
	workflowsDirectories: readonly string[];
	skillsDirectories: readonly string[];
} {
	return {
		workflowsDirectories: [paths.workflowsPath],
		skillsDirectories: [paths.skillsPath],
	};
}
