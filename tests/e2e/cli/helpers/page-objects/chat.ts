// ---------------------------------------------------------------------------
// Page-object helpers for the main Cline chat view.
// ---------------------------------------------------------------------------

import type { Terminal } from "@microsoft/tui-test/lib/terminal/term"
import { expectVisible, typeAndSubmit } from "../terminal.js"

/** Wait for the main chat view to be ready */
export async function waitForChatReady(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, "What can I do for you?")
}

/** Submit a prompt in the chat input */
export async function submitPrompt(terminal: Terminal, prompt: string, delay = 500): Promise<void> {
	await waitForChatReady(terminal)
	await typeAndSubmit(terminal, prompt, delay)
}

/** Toggle between Plan and Act mode by pressing Tab */
export async function togglePlanAct(terminal: Terminal): Promise<void> {
	terminal.write("\t")
	// Wait for the mode indicator to update rather than sleeping a fixed amount
	await expectVisible(terminal, /● Plan|● Act/)
}

/** Toggle auto-approve-all with Shift+Tab */
export async function toggleAutoApproveAll(terminal: Terminal): Promise<void> {
	terminal.write("\x1b[Z") // shift tab
}

/** Wait for "Task completed" to appear */
export async function waitForTaskCompleted(terminal: Terminal, timeout = 60_000): Promise<void> {
	await expectVisible(terminal, "Task completed", { timeout })
}

/** Wait for the "Start New Task (1)" and "Exit (2)" buttons */
export async function waitForTaskButtons(terminal: Terminal, timeout = 60_000): Promise<void> {
	await expectVisible(terminal, ["Start New Task", "Exit"], { timeout })
}

/** Press "1" to start a new task after task completion */
export async function startNewTask(terminal: Terminal): Promise<void> {
	terminal.write("1")
}

/** Press "2" to exit after task completion */
export async function exitAfterTask(terminal: Terminal): Promise<void> {
	terminal.write("2")
}

/** Wait for a permission prompt and approve it (press "1" / Save) */
export async function approvePermission(terminal: Terminal): Promise<void> {
	terminal.write("1")
}

/** Wait for a permission prompt and reject it (press "2" / Reject) */
export async function rejectPermission(terminal: Terminal): Promise<void> {
	terminal.write("2")
}

/** Navigate to /settings */
export async function openSettings(terminal: Terminal): Promise<void> {
	await waitForChatReady(terminal)
	await typeAndSubmit(terminal, "/settings")
	await expectVisible(terminal, "Settings (Esc to close)")
}

/** Navigate to /history */
export async function openHistory(terminal: Terminal): Promise<void> {
	await waitForChatReady(terminal)
	await typeAndSubmit(terminal, "/history")
}

/** Navigate to /models */
export async function openModels(terminal: Terminal): Promise<void> {
	await waitForChatReady(terminal)
	await typeAndSubmit(terminal, "/models")
}

/** Navigate to /skills */
export async function openSkills(terminal: Terminal): Promise<void> {
	await waitForChatReady(terminal)
	await typeAndSubmit(terminal, "/skills")
}
