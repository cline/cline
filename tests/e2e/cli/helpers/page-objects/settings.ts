// ---------------------------------------------------------------------------
// Page-object helpers for the /settings view.
// ---------------------------------------------------------------------------

import type { Terminal } from "@microsoft/tui-test/lib/terminal/term"
import { expectVisible, sleep } from "../terminal.js"

const TAB_ORDER = ["API", "Auto-approve", "Features", "Account", "Other"] as const

export type SettingsTab = (typeof TAB_ORDER)[number]

/** Navigate to a specific settings tab by pressing Right from the current position */
export async function goToSettingsTab(terminal: Terminal, tab: SettingsTab): Promise<void> {
	// Now navigate right to the desired tab
	const targetIndex = TAB_ORDER.indexOf(tab)
	for (let i = 0; i < targetIndex; i++) {
		terminal.keyRight()
		await sleep(200)
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
	await expectVisible(terminal, "Settings (Esc to close)")
}

/** Assert the Other tab content is visible */
export async function assertOtherTab(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Preferred language:", "Cline v"])
}
