import {
	AGENT_CONFIG_DIRECTORY_NAME,
	resolveAgentConfigSearchPaths as resolveAgentConfigSearchPathsFromShared,
	resolveAgentsConfigDirPath as resolveAgentsConfigDirPathFromShared,
} from "@clinebot/shared/storage";
import {
	type AgentYamlConfig,
	isAgentConfigYamlFile,
	normalizeAgentConfigName,
	parseAgentConfigFromYaml,
} from "./agent-config-parser";
import {
	type UnifiedConfigDefinition,
	UnifiedConfigFileWatcher,
	type UnifiedConfigWatcherEvent,
} from "./unified-config-file-watcher";

export type {
	AgentYamlConfig,
	BuildAgentConfigOverridesOptions,
	ParseYamlFrontmatterResult,
	PartialAgentConfigOverrides,
} from "./agent-config-parser";
export {
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	resolveAgentTools,
	toPartialAgentConfig,
} from "./agent-config-parser";

export type AgentConfigWatcher = UnifiedConfigFileWatcher<
	"agent",
	AgentYamlConfig
>;
export type AgentConfigWatcherEvent = UnifiedConfigWatcherEvent<
	"agent",
	AgentYamlConfig
>;

export { AGENT_CONFIG_DIRECTORY_NAME };

export function resolveAgentsConfigDirPath(): string {
	return resolveAgentsConfigDirPathFromShared();
}

export function resolveAgentConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolveAgentConfigSearchPathsFromShared(workspacePath);
}

export interface CreateAgentConfigWatcherOptions {
	workspacePath?: string;
	directoryPathOrPaths?: string | ReadonlyArray<string>;
	debounceMs?: number;
	emitParseErrors?: boolean;
}

function toDirectoryPaths(
	directoryPathOrPaths?: string | ReadonlyArray<string>,
	workspacePath?: string,
): string[] {
	if (Array.isArray(directoryPathOrPaths)) {
		return [...directoryPathOrPaths];
	}
	if (typeof directoryPathOrPaths === "string") {
		return [directoryPathOrPaths];
	}
	return resolveAgentConfigSearchPaths(workspacePath);
}

export function createAgentConfigDefinition(
	directoryPathOrPaths?: string | ReadonlyArray<string>,
	workspacePath?: string,
): UnifiedConfigDefinition<"agent", AgentYamlConfig> {
	return {
		type: "agent",
		directories: toDirectoryPaths(directoryPathOrPaths, workspacePath),
		includeFile: (fileName) => isAgentConfigYamlFile(fileName),
		parseFile: (context) => parseAgentConfigFromYaml(context.content),
		resolveId: (config) => normalizeAgentConfigName(config.name),
	};
}

export function createAgentConfigWatcher(
	options?: CreateAgentConfigWatcherOptions,
): AgentConfigWatcher {
	return new UnifiedConfigFileWatcher(
		[
			createAgentConfigDefinition(
				options?.directoryPathOrPaths,
				options?.workspacePath,
			),
		],
		{
			debounceMs: options?.debounceMs,
			emitParseErrors: options?.emitParseErrors,
		},
	);
}

export async function readAgentConfigsFromDisk(
	directoryPathOrPaths?: string | ReadonlyArray<string>,
	workspacePath?: string,
): Promise<Map<string, AgentYamlConfig>> {
	const watcher = new UnifiedConfigFileWatcher([
		createAgentConfigDefinition(directoryPathOrPaths, workspacePath),
	]);
	await watcher.refreshAll();
	const snapshot = watcher.getSnapshot("agent");
	return new Map(
		[...snapshot.entries()].map(([id, record]) => [id, record.item]),
	);
}
