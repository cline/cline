/**
 * Settings navigation constants, split from settings-view.tsx so the sidebar
 * (always mounted) can reference section names without pulling the entire
 * settings module graph — providers, MCP, marketplace, schedules — into the
 * initial chat bundle. The heavy views load on demand via next/dynamic.
 */

export const SETTINGS_SECTIONS = [
	"General",
	"Models",
	"Channels",
	"Schedules",
	"Account",
] as const;

// Mirrors the Cline Hub dashboard's Customizations nav group. Plugins is the
// unified hub for installed plugins, MCP servers, and skills; Marketplace is
// the full catalog page for installing more.
export const CUSTOMIZATION_SECTIONS = [
	"Plugins",
	"Marketplace",
	"Hooks",
	"Rules",
	"Agents",
	"Tools",
] as const;

export type SettingsSection =
	| (typeof SETTINGS_SECTIONS)[number]
	| (typeof CUSTOMIZATION_SECTIONS)[number];
