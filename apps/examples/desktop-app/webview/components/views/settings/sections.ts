/**
 * Settings navigation constants, split from settings-view.tsx so the sidebar
 * (always mounted) can reference section names without pulling the entire
 * settings module graph — providers, MCP, marketplace, schedules — into the
 * initial chat bundle. The heavy views load on demand via next/dynamic.
 */

import { isLocalRuntime } from "@/lib/local-models";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";

const ALL_SETTINGS_SECTIONS = [
	"General",
	"Account",
	"Local Models",
	"Providers",
	"Voice",
	"Keybindings",
	"Channels",
	"Schedules",
	"Import",
	"Remote",
	"Debug",
	"About",
] as const;

// Everything that decides where the chat's models come from lives under one
// "Provider" sidebar group, so users don't hunt across three pages.
export const PROVIDER_SECTIONS = [
	"Account",
	"Local Models",
	"Providers",
] as const;
export type ProviderSection = (typeof PROVIDER_SECTIONS)[number];

export const PROVIDER_SECTION_LABELS: Record<ProviderSection, string> = {
	Account: "Cline Account",
	"Local Models": "Local",
	Providers: "BYOK",
};

export function isProviderSection(
	section: SettingsSection,
): section is ProviderSection {
	return (PROVIDER_SECTIONS as readonly string[]).includes(section);
}

/** The Providers sub-page that manages the chat's current provider. */
export function readProviderSectionInUse(): ProviderSection {
	const provider = normalizeProviderId(
		readModelSelectionStorageFromWindow().lastProvider,
	);
	// Without a saved choice the chat uses the default Cline provider.
	if (!provider || provider === "cline" || provider === "cline-pass") {
		return "Account";
	}
	return isLocalRuntime(provider) ? "Local Models" : "Providers";
}

// Customize is the unified hub for everything that extends Cline — skills,
// MCP servers, plugins, rules, hooks, and tools. "Customize" is the installed
// inventory (labeled "Installed" in the sidebar group); "Marketplace" is the
// dedicated browse-and-install directory.
const ALL_CUSTOMIZATION_SECTIONS = ["Customize", "Marketplace"] as const;

// Sidebar labels for the Customize group: the Customize section shows what is
// installed, so its row reads "Installed" next to the Marketplace row.
export const CUSTOMIZATION_SECTION_LABELS: Record<
	(typeof ALL_CUSTOMIZATION_SECTIONS)[number],
	string
> = {
	Customize: "Installed",
	Marketplace: "Marketplace",
};

export type SettingsSection =
	| (typeof ALL_SETTINGS_SECTIONS)[number]
	| (typeof ALL_CUSTOMIZATION_SECTIONS)[number];

// Temporarily hidden from the sidebar. The views and routes still exist —
// remove a section from this set to surface it again.
const HIDDEN_SECTIONS: ReadonlySet<SettingsSection> = new Set(["Channels"]);

export const SETTINGS_SECTIONS = ALL_SETTINGS_SECTIONS.filter(
	(section) => !HIDDEN_SECTIONS.has(section),
);

export const CUSTOMIZATION_SECTIONS = ALL_CUSTOMIZATION_SECTIONS.filter(
	(section) => !HIDDEN_SECTIONS.has(section),
);
