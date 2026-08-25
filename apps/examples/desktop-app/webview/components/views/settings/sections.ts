/**
 * Settings navigation constants, split from settings-view.tsx so the sidebar
 * (always mounted) can reference section names without pulling the entire
 * settings module graph — providers, MCP, marketplace, schedules — into the
 * initial chat bundle. The heavy views load on demand via next/dynamic.
 */

const ALL_SETTINGS_SECTIONS = [
	"General",
	"Models",
	"Voice",
	"Channels",
	"Schedules",
	"Account",
] as const;

// Mirrors the Cline Hub dashboard's Customizations nav group. Plugins is the
// unified hub for installed plugins, MCP servers, and skills; Marketplace is
// the full catalog page for installing more.
const ALL_CUSTOMIZATION_SECTIONS = [
	"Plugins",
	"Marketplace",
	"Hooks",
	"Rules",
	"Agents",
	"Tools",
] as const;

export type SettingsSection =
	| (typeof ALL_SETTINGS_SECTIONS)[number]
	| (typeof ALL_CUSTOMIZATION_SECTIONS)[number];

// Temporarily hidden from the sidebar. The views and routes still exist —
// remove a section from this set to surface it again.
const HIDDEN_SECTIONS: ReadonlySet<SettingsSection> = new Set([
	"Channels",
	"Agents",
]);

export const SETTINGS_SECTIONS = ALL_SETTINGS_SECTIONS.filter(
	(section) => !HIDDEN_SECTIONS.has(section),
);

export const CUSTOMIZATION_SECTIONS = ALL_CUSTOMIZATION_SECTIONS.filter(
	(section) => !HIDDEN_SECTIONS.has(section),
);
