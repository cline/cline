// ---------------------------------------------------------------------------
// CLI Interactive use cases — main chat view
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

import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import {
	approveTool,
	exitAfterTask,
	openHistory,
	openModels,
	openSettings,
	openSkills,
	startNewTask,
	toggleAutoApproveAll,
	togglePlanAct,
	waitForApproveReject,
	waitForChatReady,
	waitForTaskButtons,
} from "../helpers/page-objects/chat.js";
import {
	assertApiTab,
	assertAutoApproveTab,
	assertFeaturesTab,
	assertOtherTab,
	goToSettingsTab,
} from "../helpers/page-objects/settings.js";
import {
	expectNotVisible,
	expectVisible,
	gracefulShutdown,
	typeAndSubmit,
	waitForTerminalExit,
} from "../helpers/terminal.js";

test.describe("cline (unauthenticated) — shows auth view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test.skip("shows interactive auth view when not authenticated", async ({
		terminal,
	}) => {
		await expectVisible(terminal, /sign in|authenticate|api key/i, {
			timeout: 10_000,
		});
	});
});

test.describe("cline (authenticated) — shows chat view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test.skip("shows interactive chat view", async ({ terminal }) => {
		await waitForChatReady(terminal);
	});
});

test.describe("/settings — tab navigation", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test.skip("opens settings and shows API tab by default", async ({
		terminal,
	}) => {
		await openSettings(terminal);
		await assertApiTab(terminal);
	});

	test.skip("can navigate to Auto-approve tab with keyRight", async ({
		terminal,
	}) => {
		await openSettings(terminal);
		terminal.keyRight();
		await assertAutoApproveTab(terminal);
	});

	test.skip("can navigate to Features tab", async ({ terminal }) => {
		await openSettings(terminal);
		await goToSettingsTab(terminal, "Features");
		await assertFeaturesTab(terminal);
	});

	test.skip("can navigate to Other tab", async ({ terminal }) => {
		await openSettings(terminal);
		await goToSettingsTab(terminal, "Other");
		await assertOtherTab(terminal);
	});

	test.skip("pressing Escape closes settings", async ({ terminal }) => {
		await openSettings(terminal);
		terminal.keyEscape();
		await waitForChatReady(terminal);
	});
});

test.describe("/models — model browser", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test.skip("opens models view with featured models", async ({ terminal }) => {
		await openModels(terminal);
		await expectVisible(terminal, "Browse all models...");
	});

	test.skip("pressing Escape returns to chat view", async ({ terminal }) => {
		await openModels(terminal);
		await expectVisible(terminal, /model|browse/i, { timeout: 5000 });
		terminal.keyEscape();
		await waitForChatReady(terminal);
	});
});

test.describe("/history — task history", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test.skip("opens history view", async ({ terminal }) => {
		await openHistory(terminal);
		await expectVisible(terminal, /history|task/i);
	});

	test.skip("pressing Escape closes history", async ({ terminal }) => {
		await openHistory(terminal);
		await expectVisible(terminal, /history|task/i);
		terminal.keyEscape();
		await waitForChatReady(terminal);
	});
});

test.describe("/skills — skills view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("opens skills view", async ({ terminal }) => {
		await openSkills(terminal);
		await expectVisible(terminal, "Skills (Esc to close)");
	});

	test.skip("pressing Escape closes skills", async ({ terminal }) => {
		await openSkills(terminal);
		await expectVisible(terminal, "Skills (Esc to close)");
		terminal.keyEscape();
		await waitForChatReady(terminal);
	});
});

test.describe("Plan/Act mode toggle", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("pressing Tab toggles between Plan and Act mode", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "○ Plan ● Act");
		await togglePlanAct(terminal);
		await expectVisible(terminal, "● Plan ○ Act");
	});
});

test.describe("Auto-approve all — Shift+Tab toggle", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("Shift+Tab toggles auto-approve-all setting", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "Auto-approve all disabled");
		await toggleAutoApproveAll(terminal);
		await expectVisible(terminal, "Auto-approve all enabled");
		await toggleAutoApproveAll(terminal);
	});
});

test.describe("Task completed — Start New Task button @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/task-complete-new-task.json",
		}),
	});

	test.skip("pressing 1 (Start New Task) clears screen and shows fresh prompt", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "just say hello");
		await waitForTaskButtons(terminal);
		startNewTask(terminal);
		await expectNotVisible(terminal, "just say hello");
		await gracefulShutdown(terminal);
	});
});

test.describe("Task completed — Exit button @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/task-complete-exit.json",
		}),
	});

	test.skip("pressing 2 (Exit) exits the app with code 0", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "just say hello");
		await waitForTaskButtons(terminal);
		exitAfterTask(terminal);
		const exitCode = await waitForTerminalExit(terminal);
		expect(exitCode).toBe(0);
	});
});

test.describe("read file outside cwd requires permission @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/read-file-outside-cwd.json",
		}),
	});

	test.skip("reading file outside cwd requires permission when readFilesExternally is off", async ({
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

test.describe("Auto-approve — safe command doesn't require permission @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/safe-command-no-permission.json",
		}),
	});

	test.skip("executing 'date' bash command requires no permission", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(
			terminal,
			"run date bash command and show me the output",
		);
		await waitForTaskButtons(terminal);
		await gracefulShutdown(terminal);
	});
});

test.describe("Subagents @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/subagents.json",
		}),
	});

	test.skip("shows subagent UI when using subagents", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "tell 3 jokes using subagents");
		await expectVisible(terminal, /subagent|running subagent/i, {
			timeout: 30_000,
		});
		await waitForTaskButtons(terminal);
		await gracefulShutdown(terminal);
	});
});

test.describe("Web tools — web fetch", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/web-fetch.json",
		}),
	});

	test.skip("uses the web fetch tool", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await toggleAutoApproveAll(terminal);
		await typeAndSubmit(
			terminal,
			"summarize this web page in one sentence: https://cline.bot/",
		);
		await waitForTaskButtons(terminal);
		await gracefulShutdown(terminal);
	});
});

test.describe("/settings — Account Tab organization editing", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("can navigate to Account tab and see account info", async ({
		terminal,
	}) => {
		await openSettings(terminal);
		await goToSettingsTab(terminal, "Account");
		await expectVisible(terminal, /sign in|account|organization/i);
	});
});

test.describe("Auto-approve all — file edit requires no permission", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/file-edit-auto-approve.json",
		}),
	});

	test.skip("with auto-approve-all enabled, file edit does not prompt for permission", async ({
		terminal,
	}) => {
		const file = path.resolve("/tmp", "testFile.txt");
		writeFileSync(file, "This is a test file with content");
		try {
			await waitForChatReady(terminal);
			await toggleAutoApproveAll(terminal);
			await expectVisible(terminal, "Auto-approve all enabled");
			await typeAndSubmit(terminal, `append sup to ${file}`);
			await waitForTaskButtons(terminal);
			await gracefulShutdown(terminal);
		} finally {
			try {
				unlinkSync(file);
			} catch {}
		}
	});
});
