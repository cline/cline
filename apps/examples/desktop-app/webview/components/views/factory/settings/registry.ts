import { FS_PAGES } from "@/lib/factory-settings-copy/shell";
import { settingsPage as automation } from "./pages/automation";
import { settingsPage as connections } from "./pages/connections";
import { settingsPage as data } from "./pages/data-reset";
import { settingsPage as guidance } from "./pages/guidance";
import { settingsPage as limits } from "./pages/limits";
import { settingsPage as projects } from "./pages/projects";
import { settingsPage as roles } from "./pages/roles";
import { settingsPage as stages } from "./pages/stages";
import { settingsPage as verification } from "./pages/test-setup";
import { settingsPage as computer } from "./pages/this-computer";
import { settingsPage as workflows } from "./pages/workflows";
import type {
	SettingsGroupId,
	SettingsPageDefinition,
	SettingsPageEntry,
	SettingsPageId,
} from "./types";

const entry = (
	id: SettingsPageId,
	group: SettingsGroupId,
	definition: SettingsPageDefinition,
): SettingsPageEntry => ({ ...definition, id, group, title: FS_PAGES[id] });

/** Every Factory settings page, in section-list order. */
export const SETTINGS_PAGES: readonly SettingsPageEntry[] = [
	entry("automation", "factory", automation),
	entry("limits", "factory", limits),
	entry("roles", "workers", roles),
	entry("guidance", "workers", guidance),
	entry("stages", "pipeline", stages),
	entry("verification", "pipeline", verification),
	entry("projects", "where", projects),
	entry("computer", "where", computer),
	entry("connections", "where", connections),
	entry("workflows", "advanced", workflows),
	entry("data", "advanced", data),
];

export const SETTINGS_PAGE_IDS = SETTINGS_PAGES.map((page) => page.id);

/** Section ids from before the redesign, kept in session storage. */
const OLD_PAGE_IDS: Record<string, SettingsPageId> = {
	general: "automation",
	models: "roles",
	projects: "projects",
};

export function settingsPageId(value: unknown): SettingsPageId | undefined {
	if (typeof value !== "string") return undefined;
	if ((SETTINGS_PAGE_IDS as readonly string[]).includes(value))
		return value as SettingsPageId;
	return OLD_PAGE_IDS[value];
}
