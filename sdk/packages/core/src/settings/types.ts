import type { UserInstructionConfigService } from "../extensions/config";
import type { BuiltinToolAvailabilityContext } from "../extensions/tools";

export type CoreSettingsType =
	| "skills"
	| "workflows"
	| "rules"
	| "plugins"
	| "tools"
	| "mcp";

export type CoreSettingsItemKind =
	| "skill"
	| "workflow"
	| "rule"
	| "plugin"
	| "tool"
	| "mcp";

export type CoreSettingsItemSource =
	| "global"
	| "workspace"
	| "builtin"
	| "global-plugin"
	| "workspace-plugin";

export interface CoreSettingsItem {
	id: string;
	name: string;
	path: string;
	kind: CoreSettingsItemKind;
	source: CoreSettingsItemSource;
	enabled?: boolean;
	description?: string;
	toggleable?: boolean;
	pluginName?: string;
	pluginPath?: string;
	contributions?: CorePluginContributions;
}

export interface CorePluginContributions {
	inspectionStatus: "available" | "disabled" | "failed";
	capabilities: string[];
	tools: string[];
	skills: string[];
	rules: string[];
	hooks: string[];
	commands: string[];
	mcpServers: string[];
	providers: string[];
}

export interface CorePluginSettingsSnapshot {
	plugins: CoreSettingsItem[];
	tools: CoreSettingsItem[];
}

export interface CorePluginSettingsSource {
	list(input: CoreSettingsListInput): Promise<CorePluginSettingsSnapshot>;
	/** Apply enablement and return the source's authoritative post-mutation state. */
	setEnabled(input: {
		path: string;
		enabled: boolean;
		cwd?: string;
		workspaceRoot?: string;
	}): Promise<CorePluginSettingsSnapshot>;
}

export interface CoreSettingsServiceOptions {
	pluginSource?: CorePluginSettingsSource;
}

export interface CoreSettingsSnapshot {
	workflows: CoreSettingsItem[];
	rules: CoreSettingsItem[];
	plugins: CoreSettingsItem[];
	skills: CoreSettingsItem[];
	tools: CoreSettingsItem[];
	mcp: CoreSettingsItem[];
}

export interface CoreSettingsListInput {
	cwd?: string;
	workspaceRoot?: string;
	userInstructionService?: UserInstructionConfigService;
	availabilityContext?: BuiltinToolAvailabilityContext;
}

export interface CoreSettingsToggleInput extends CoreSettingsListInput {
	type: CoreSettingsType;
	id?: string;
	path?: string;
	name?: string;
	enabled?: boolean;
}

export interface CoreSettingsMutationResult {
	snapshot: CoreSettingsSnapshot;
	changedTypes: CoreSettingsType[];
}

export interface ClineCoreSettingsApi {
	list(input?: CoreSettingsListInput): Promise<CoreSettingsSnapshot>;
	toggle(input: CoreSettingsToggleInput): Promise<CoreSettingsMutationResult>;
}
