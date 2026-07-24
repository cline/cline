// ---------------------------------------------------------------------------
// CLI Interactive use cases - main chat view
//
// Covers:
//   - `cline` launches interactive view (authed / unauthed)
//   - /settings navigation and tab verification
//   - /models view
//   - /history view
//   - /skills view
//   - Plan/Act mode toggle (Tab)
//   - Plan task → toggle to Act → task executes
//   - Act task → file edit permission prompt → Save / Reject
//   - Task completed → Start New Task / Exit buttons
//   - Auto-approve settings
//   - Subagents
//   - Web tools
//   - Auto-approve all (Shift+Tab)
// ---------------------------------------------------------------------------

import { expect, test } from "@microsoft/tui-test";
import type { Terminal } from "@microsoft/tui-test/lib/terminal/term";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import {
	toggleAutoApproveAll,
	waitForChatReady,
} from "../helpers/page-objects/chat.js";
import {
	expectNotVisible,
	expectVisible,
	typeAndSubmit,
} from "../helpers/terminal.js";

test.describe("cline (authenticated) - shows chat view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("shows interactive chat view", async ({ terminal }) => {
		await waitForChatReady(terminal);
	});
});

test.describe("Auto-approve all - Shift+Tab toggle", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("Shift+Tab toggles auto-approve-all setting", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "Auto-approve all enabled");
		await toggleAutoApproveAll(terminal);
		await expectVisible(terminal, "Auto-approve all disabled");
		await toggleAutoApproveAll(terminal);
	});
});

test.describe("Dialog dismissal - panel is fully removed", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	// The dialog panel's background is @opentui-ui/dialog's DEFAULT_STYLE
	// (#262626), which xterm reports as this packed 24-bit color.
	const DIALOG_PANEL_BG = 0x262626;

	const countPanelCells = (terminal: Terminal): number => {
		let count = 0;
		for (const shift of terminal.serialize().shifts.values()) {
			if (shift.bgColor === DIALOG_PANEL_BG) {
				count++;
			}
		}
		return count;
	};

	// @opentui-ui/dialog is built against @opentui/core ^0.1.69, whose
	// Renderable.remove(id) took an id. Core 0.4.x renamed it to
	// remove(child) and throws on a non-renderable argument, so the
	// package's removeDialog() aborted before detaching its panel — the React
	// portal content unmounted, but the imperative grey box stayed on screen
	// over the chat. Asserting on the panel's background (not its text) is what
	// distinguishes a leaked box from a clean teardown.
	test("closing the help dialog removes its grey panel", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "/help");
		await expectVisible(terminal, "Keyboard Shortcuts");
		expect(countPanelCells(terminal)).toBeGreaterThan(0);

		terminal.keyEscape();
		await expectNotVisible(terminal, "Keyboard Shortcuts");

		// The panel unmounts a frame after its content; poll until the
		// dialog's imperative box is detached rather than sampling once.
		const deadline = Date.now() + 10_000;
		let remaining = countPanelCells(terminal);
		while (remaining > 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			remaining = countPanelCells(terminal);
		}
		expect(remaining).toBe(0);
	});
});
