import {
	resolveAgentConfigSearchPaths,
	resolveClineDataDir,
	resolveClineDir,
	resolveConnectorSettingsPath,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolvePluginConfigSearchPaths,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveSkillsConfigSearchPaths,
	resolveTeamDataDir,
	resolveWorkflowsConfigSearchPaths,
} from "@cline/shared/storage";
import type { SkillConfig } from "./user-instruction-config-loader";

export interface BuiltinSkill {
	id: string;
	skill: SkillConfig;
}

function formatPaths(paths: ReadonlyArray<string>): string {
	return paths.map((path) => `- \`${path}\``).join("\n");
}

function createSettingsInstructions(workspacePath?: string): string {
	return `Use these resolved locations when answering questions about Cline configuration. These values come from the same path resolvers as the running Cline core; do not substitute remembered paths from older conversations or documentation.

## Active shared files

- Cline home: \`${resolveClineDir()}\`
- Cline data: \`${resolveClineDataDir()}\`
- Provider credentials and model configuration: \`${resolveProviderSettingsPath()}\`
- Global behavioral settings: \`${resolveGlobalSettingsPath()}\`
- MCP server configuration: \`${resolveMcpSettingsPath()}\`
- Connector configuration: \`${resolveConnectorSettingsPath()}\`
- Sessions: \`${resolveSessionDataDir()}\`
- Agent team state: \`${resolveTeamDataDir()}\`

The provider and MCP files can contain credentials or tokens. Do not print their contents, commit them, or copy secrets into chat unless the user explicitly requests a safe, redacted inspection.

## Configuration search locations

Cline merges configuration from several locations. The following are search locations, not aliases for one active file. More specific workspace entries can coexist with global entries.

### Rules
${formatPaths(resolveRulesConfigSearchPaths(workspacePath))}

### Skills
${formatPaths(resolveSkillsConfigSearchPaths(workspacePath))}

### Workflows
${formatPaths(resolveWorkflowsConfigSearchPaths(workspacePath))}

### Hooks
${formatPaths(resolveHooksConfigSearchPaths(workspacePath))}

### Plugins
${formatPaths(resolvePluginConfigSearchPaths(workspacePath))}

### Configured agents
${formatPaths(resolveAgentConfigSearchPaths(workspacePath))}

## How to use this information

- Prefer product UI actions that open a configuration file when they are available; the UI and this skill use the active runtime location.
- Before editing JSON, read the existing file and preserve unrelated entries.
- Do not infer that a nearby file owns a setting. In particular, MCP servers belong in the MCP configuration file, not the global settings file.
- Paths in an older conversation may refer to pre-SDK extension storage or other legacy locations. Treat them as historical unless the current runtime reports the same path.
- Environment overrides may change these locations between processes. Invoke this skill again in the process whose configuration you are diagnosing.`;
}

export function listBuiltinSkills(workspacePath?: string): BuiltinSkill[] {
	return [
		{
			id: "cline-settings",
			skill: {
				name: "cline-settings",
				description:
					"Locate Cline settings, configuration files, and search directories using the current runtime paths.",
				get instructions() {
					return createSettingsInstructions(workspacePath);
				},
				frontmatter: {},
			},
		},
	];
}
