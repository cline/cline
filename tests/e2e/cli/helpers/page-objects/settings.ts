// ---------------------------------------------------------------------------
// Page-object helpers for the /settings view.
// ---------------------------------------------------------------------------

import type { Terminal } from "@microsoft/tui-test/lib/terminal/term"
import { expectVisible } from "../terminal.js"

const TAB_ORDER = ["API", "Auto-approve", "Features", "Account", "Other"] as const

export type SettingsTab = (typeof TAB_ORDER)[number]

/**
 * Navigate to a specific settings tab by pressing Right from the API tab (index 0).
 * Waits for each tab's content to appear before pressing the next key, making
 * navigation deterministic regardless of machine speed.
 */
export async function goToSettingsTab(terminal: Terminal, tab: SettingsTab): Promise<void> {
	const targetIndex = TAB_ORDER.indexOf(tab)
	for (let i = 0; i < targetIndex; i++) {
		terminal.keyRight()
		// Wait for the next tab's content to appear before pressing again
		await assertTabContent(terminal, TAB_ORDER[i + 1])
	}
}

/** Assert the API tab content is visible */
export async function assertApiTab(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Provider:", "Model ID:"])
}

/** Assert the Auto-approve tab content is visible */
export async function assertAutoApproveTab(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Read project files", "Execute safe commands", "Edit project files"])
}

/** Assert the Features tab content is visible */
export async function assertFeaturesTab(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Subagents", "Web tools", "Double-check completion"])
}

/** Assert the Account tab content is visible */
export async function assertAccountTab(terminal: Terminal): Promise<void> {
	// The account tab shows sign-in options when not authenticated to Cline
	await expectVisible(terminal, /sign in|sign out/i)
}

/** Assert the Other tab content is visible */
export async function assertOtherTab(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Preferred language:", "Cline v"])
}

/**
 * Assert the content for a given tab is visible.
 * Used internally by goToSettingsTab to confirm navigation landed correctly.
 */
export async function assertTabContent(terminal: Terminal, tab: SettingsTab): Promise<void> {
	switch (tab) {
		case "API":
			return assertApiTab(terminal)
		case "Auto-approve":
			return assertAutoApproveTab(terminal)
		case "Features":
			return assertFeaturesTab(terminal)
		case "Account":
			return assertAccountTab(terminal)
		case "Other":
			return assertOtherTab(terminal)
	}
}
