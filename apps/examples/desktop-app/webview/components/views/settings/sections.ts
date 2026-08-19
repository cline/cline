/**
 * Settings navigation constants, split from settings-view.tsx so the sidebar
 * (always mounted) can reference section names without pulling the entire
 * settings module graph — providers, MCP, marketplace, schedules — into the
 * initial chat bundle. The heavy views load on demand via next/dynamic.
 */

export const SETTINGS_SECTIONS = [
	"General",
	"Models",
	"Schedules",
	"Account",
] as const;

// Mirrors the Cline Hub dashboard's Customizations nav group. Plugins is the
// unified hub for plugins, apps (connector channels), MCP servers, and skills,
// including the marketplace directory.
export const CUSTOMIZATION_SECTIONS = [
	"Plugins",
	"Hooks",
	"Rules",
	"Agents",
	"Tools",
] as const;

export type SettingsSection =
	| (typeof SETTINGS_SECTIONS)[number]
	| (typeof CUSTOMIZATION_SECTIONS)[number];
