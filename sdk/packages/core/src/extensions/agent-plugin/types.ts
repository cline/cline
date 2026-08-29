import type { McpServerRegistration } from "../mcp";
import type { AgentSkillMetadata } from "./agent-skill";

export interface AgentPluginPackageManifest {
	$schema: string;
	name: string;
	version?: string;
	description?: string;
	author?: {
		name?: string;
		email?: string;
		url?: string;
	};
	homepage?: string;
	repository?: string;
	license?: string;
	keywords?: string[];
	extensions?: Record<string, unknown>;
}

export interface AgentPluginPackageSkill {
	pluginName: string;
	pluginRoot: string;
	directoryPath: string;
	filePath: string;
	metadata: AgentSkillMetadata;
}

export interface AgentPluginPackageMcpServer {
	pluginName: string;
	pluginRoot: string;
	pluginDataPath?: string;
	serverName: string;
	registration: McpServerRegistration;
}

/**
 * The Cline client-extension namespace (`bot.cline`, Cline's domain reversed):
 * a single Cline plugin module (`AgentExtension`) an Agent Plugin points at
 * from its `bot.cline/` directory. Resolving it is read-only discovery, same
 * as skills/MCP; the module itself is only imported when a session actually
 * loads it, through the existing sandboxed Cline plugin pipeline.
 */
export interface AgentPluginPackageClineExtension {
	pluginName: string;
	pluginRoot: string;
	entryPath: string;
}

export type AgentPluginPackageDiagnosticScope =
	| "plugin"
	| "manifest"
	| "skills"
	| "skill"
	| "mcp"
	| "mcp-server"
	| "cline-extension";

export interface AgentPluginPackageDiagnostic {
	level: "warning" | "error";
	scope: AgentPluginPackageDiagnosticScope;
	pluginPath: string;
	pluginName?: string;
	componentPath?: string;
	componentName?: string;
	message: string;
}

export interface LoadedAgentPluginPackage {
	rootPath: string;
	manifestPath: string;
	manifest: AgentPluginPackageManifest;
	skills: AgentPluginPackageSkill[];
	mcpServers: AgentPluginPackageMcpServer[];
	clineExtension?: AgentPluginPackageClineExtension;
}

export interface AgentPluginPackageLoadReport {
	plugins: LoadedAgentPluginPackage[];
	skills: AgentPluginPackageSkill[];
	mcpServers: AgentPluginPackageMcpServer[];
	clineExtensions: AgentPluginPackageClineExtension[];
	diagnostics: AgentPluginPackageDiagnostic[];
}

export interface LoadAgentPluginPackagesOptions {
	/** Explicit plugin roots, resolved on the runtime host relative to `cwd`. */
	pluginPaths?: ReadonlyArray<string>;
	/** Base directory for resolving relative explicit plugin paths. */
	cwd?: string;
	/** Override automatic search roots. Primarily useful to embedded hosts/tests. */
	searchPaths?: ReadonlyArray<string>;
	/** Override the client-managed persistent Agent Plugin data root. */
	pluginDataRoot?: string;
	/** Manifest names disabled by the runtime host. Disabled names still reserve precedence. */
	disabledPluginNames?: ReadonlyArray<string>;
}
