import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { waitForChatReady } from "./helpers/page-objects/chat.js";
import { expectVisible, typeAndSubmit } from "./helpers/terminal.js";

test.describe("cline interactive basics", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: clineEnv("default"),
	});

	test("shows logo, prompt, mode toggles, and hints", async ({ terminal }) => {
		await expectVisible(terminal, [
			"What can I do for you?",
			":::::::",
			"Plan",
			"Act",
			"@ for files",
			"Tab",
		]);
	});

	test("shows slash commands after / input", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await typeAndSubmit(terminal, "/");
		await expectVisible(terminal, ["/settings"], {
			timeout: 5000,
		});
	});
});
