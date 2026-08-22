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

// Shared Customizations navigation group for desktop settings.
export const CUSTOMIZATION_SECTIONS = [
	"Plugins",
	"Skills",
	"MCP",
	"Hooks",
	"Rules",
	"Tools",
	"System Prompt",
] as const;

export type SettingsSection =
	| (typeof SETTINGS_SECTIONS)[number]
	| (typeof CUSTOMIZATION_SECTIONS)[number];
