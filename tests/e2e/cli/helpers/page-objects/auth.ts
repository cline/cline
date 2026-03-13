import { Terminal } from "@microsoft/tui-test/lib/terminal/term"
import { expectVisible } from "../terminal.js"

export async function waitForAuthScreen(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, ["Sign in with Cline", "Sign in with ChatGPT", "Use your own API key"])
}
