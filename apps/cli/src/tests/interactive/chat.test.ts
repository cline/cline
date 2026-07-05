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

import { test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import {
	toggleAutoApproveAll,
	waitForChatReady,
} from "../helpers/page-objects/chat.js";
import { expectVisible } from "../helpers/terminal.js";

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
