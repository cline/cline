import { createHash } from "node:crypto";
import path from "node:path";
import { resolveClineDataDir } from "../storage/paths";
import type { RemoteConfigManagedPaths } from "./bundle";

export const DEFAULT_REMOTE_CONFIG_PLUGIN_NAME = "remote-config";

function sanitizeCacheSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-") || "remote-config";
}

export function resolveRemoteConfigBundleCachePath(input: {
	workspacePath: string;
	pluginName?: string;
}): string {
	const pluginName = input.pluginName ?? DEFAULT_REMOTE_CONFIG_PLUGIN_NAME;
	const workspaceCacheKey = createHash("sha256")
		.update(path.resolve(input.workspacePath))
		.digest("hex");
	return path.join(
		resolveClineDataDir(),
		"remote-config",
		sanitizeCacheSegment(pluginName),
		workspaceCacheKey,
		"bundle.json",
	);
}

export function resolveLegacyWorkspaceRemoteConfigBundleCachePath(input: {
	workspacePath: string;
	pluginName?: string;
}): string {
	const pluginName = input.pluginName ?? DEFAULT_REMOTE_CONFIG_PLUGIN_NAME;
	return path.join(input.workspacePath, ".cline", pluginName, "cache", "bundle.json");
}

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
		bundleCachePath: resolveRemoteConfigBundleCachePath(input),
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
