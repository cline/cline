import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import {
	approveTool,
	waitForActing,
	waitForApproveReject,
	waitForChatReady,
	waitForTaskButtons,
} from "./helpers/page-objects/chat.js";
import {
	assertAccountTab,
	assertApiTab,
	assertAutoApproveTab,
	assertFeaturesTab,
	assertOtherTab,
} from "./helpers/page-objects/settings.js";
import {
	expectVisible,
	gracefulShutdown,
	typeAndSubmit,
} from "./helpers/terminal.js";

test.describe("cline interactive basics", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: clineEnv("default"),
	});

	test.skip("shows logo, prompt, mode toggles, and hints", async ({
		terminal,
	}) => {
		await expectVisible(terminal, [
			"What can I do for you?",
			"@@@@@@",
			"Plan",
			"Act",
			"@ for files",
			"Tab",
		]);
	});

	test.skip("shows slash commands after / input", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?");
		await typeAndSubmit(terminal, "/");
		await expectVisible(terminal, ["/help", "/settings", "/models"], {
			timeout: 5000,
		});
	});

	test.skip("opens /settings and navigates tabs with left/right arrows", async ({
		terminal,
	}) => {
		await expectVisible(terminal, "What can I do for you?");
		await typeAndSubmit(terminal, "/settings");
		await expectVisible(terminal, "Settings (Esc to close)");
		await assertApiTab(terminal);
		await expectVisible(terminal, "Use separate models for Plan and Act");
		terminal.keyRight();
		await assertAutoApproveTab(terminal);
		terminal.keyRight();
		await assertFeaturesTab(terminal);
		terminal.keyRight();
		await assertAccountTab(terminal);
		terminal.keyRight();
		await assertOtherTab(terminal);
		terminal.keyLeft();
		await assertAccountTab(terminal);
		terminal.keyRight();
		await assertOtherTab(terminal);
		terminal.keyRight();
		await assertApiTab(terminal);
	});
});

test.describe("cline interactive prompt submission", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/hello-and-goodbye.json",
		}),
	});

	test.skip("submits 'just say hello' and LLM responds with 'hello'", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "just say hello");
		await waitForTaskButtons(terminal);
		await typeAndSubmit(terminal, "now say goodbye");
		await waitForActing(terminal);
		await waitForTaskButtons(terminal);
		await gracefulShutdown(terminal);
	});
});

test.describe("cline interactive prompt read file", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/read-file.json",
		}),
	});

	test.skip("submits 'read a file outside my workspace' and LLM asks permission", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "read my ~/.wezterm.lua file");
		await waitForApproveReject(terminal);
		approveTool(terminal);
		await waitForTaskButtons(terminal);
		await gracefulShutdown(terminal);
	});
});
