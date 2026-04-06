import path from "node:path";
import type { EnterprisePaths } from "../contracts";

export function resolveEnterprisePaths(input: {
	workspacePath: string;
	pluginName?: string;
}): EnterprisePaths {
	const pluginName = input.pluginName ?? "enterprise";
	const pluginPath = path.join(input.workspacePath, ".cline", pluginName);
	return {
		pluginName,
		pluginPath,
		workflowsPath: path.join(pluginPath, "workflows"),
		skillsPath: path.join(pluginPath, "skills"),
		bundleCachePath: path.join(pluginPath, "cache", "bundle.json"),
		tokenCachePath: path.join(pluginPath, "cache", "token.json"),
		manifestPath: path.join(pluginPath, "managed.json"),
		rulesFilePath: path.join(pluginPath, "rules.md"),
	};
}

export function getEnterpriseCommandDirectories(paths: EnterprisePaths): {
	workflowsDirectories: readonly string[];
	skillsDirectories: readonly string[];
} {
	return {
		workflowsDirectories: [paths.workflowsPath],
		skillsDirectories: [paths.skillsPath],
	};
}
