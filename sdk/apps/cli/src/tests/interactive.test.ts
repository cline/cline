import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { waitForChatReady } from "./helpers/page-objects/chat.js";
import { expectVisible } from "./helpers/terminal.js";

test.describe("cline interactive basics", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: clineEnv("default"),
	});

	test("shows logo, prompt, and hints", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, ["@ for file mentions", "Tab"]);
	});

	test("shows slash commands after / input", async ({ terminal }) => {
		await waitForChatReady(terminal);
		// Type "/" without submitting to trigger the slash menu
		terminal.write("/");
		await expectVisible(terminal, ["/settings", "/mcp"], {
			timeout: 10_000,
		});
	});
});
