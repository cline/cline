import type { UserInstructionConfigWatcher } from "../extensions/config";
import type { BuiltinToolAvailabilityContext } from "../extensions/tools";

export type CoreSettingsType = "skills" | "workflows" | "rules" | "tools";

export type CoreSettingsItemKind = "skill" | "workflow" | "rule" | "tool";

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
}

export interface CoreSettingsSnapshot {
	workflows: CoreSettingsItem[];
	rules: CoreSettingsItem[];
	skills: CoreSettingsItem[];
	tools: CoreSettingsItem[];
}

export interface CoreSettingsListInput {
	cwd?: string;
	workspaceRoot?: string;
	userInstructionWatcher?: UserInstructionConfigWatcher;
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
