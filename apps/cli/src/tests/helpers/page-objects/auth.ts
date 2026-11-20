import type { TuiTest as Terminal } from "@microsoft/tui-test";
import { expectVisible } from "../terminal.js";

export async function waitForAuthScreen(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, [
		"Sign in with Cline",
		"Sign in with ChatGPT",
		"Bring your own provider",
	]);
}
