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

import type { Cell, Color, TuiTest as Terminal } from "@microsoft/tui-test";
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
import { expect, test } from "../helpers/test.js";

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

	type TerminalSnapshot = {
		text: string;
		cells: Cell[];
	};
	const backgroundsEqual = (
		left: Color | undefined,
		right: Color | undefined,
	): boolean => left === right;
	const snapshotTerminal = async (
		terminal: Terminal,
	): Promise<TerminalSnapshot> => ({
		text: await terminal.text(),
		cells: await terminal.cells(
			0,
			0,
			TERMINAL_WIDE.columns,
			TERMINAL_WIDE.rows,
		),
	});

	const findTextPosition = (
		snapshot: TerminalSnapshot,
		text: string,
	): { x: number; y: number } => {
		const lines = snapshot.text.split("\n");
		for (let y = 0; y < lines.length; y++) {
			const x = lines[y].indexOf(text);
			if (x !== -1) {
				return { x, y };
			}
		}
		throw new Error(`Unable to locate visible text: ${text}`);
	};

	const getCellBackground = (
		snapshot: TerminalSnapshot,
		position: { x: number; y: number },
	): Color | undefined => {
		return snapshot.cells.find(
			(cell) => cell.x === position.x && cell.y === position.y,
		)?.bg;
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
		const terminalBeforeDialog = await snapshotTerminal(terminal);
		await typeAndSubmit(terminal, "/help");
		await expectVisible(terminal, "Keyboard Shortcuts");
		const terminalWithDialog = await snapshotTerminal(terminal);
		const dialogPosition = findTextPosition(
			terminalWithDialog,
			"Keyboard Shortcuts",
		);
		const backgroundAtDialogPosition = getCellBackground(
			terminalBeforeDialog,
			dialogPosition,
		);
		const dialogBackground = getCellBackground(
			terminalWithDialog,
			dialogPosition,
		);
		expect(dialogBackground).not.toEqual(backgroundAtDialogPosition);

		await terminal.press("Escape");
		await expectNotVisible(terminal, "Keyboard Shortcuts");

		// The panel unmounts a frame after its content. Poll the title's former
		// position until the background captured from the visible panel is gone.
		const deadline = Date.now() + 10_000;
		let backgroundAfterDialog = getCellBackground(
			await snapshotTerminal(terminal),
			dialogPosition,
		);
		while (
			!backgroundsEqual(backgroundAfterDialog, backgroundAtDialogPosition) &&
			Date.now() < deadline
		) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			backgroundAfterDialog = getCellBackground(
				await snapshotTerminal(terminal),
				dialogPosition,
			);
		}
		expect(backgroundAfterDialog).toEqual(backgroundAtDialogPosition);
	});
});
