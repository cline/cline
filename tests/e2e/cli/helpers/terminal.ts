// ---------------------------------------------------------------------------
// Terminal interaction helpers for TUI tests.
//
// These wrap common tui-test patterns to keep test bodies readable.
// ---------------------------------------------------------------------------

import { expect } from "@microsoft/tui-test"
import type { Terminal } from "@microsoft/tui-test/lib/terminal/term"

// ---------------------------------------------------------------------------
// Core wait / assertion helpers
// ---------------------------------------------------------------------------

const maxTimeoutMs = 10_000

/**
 * Wait for one or more text strings/regexes to appear on screen.
 *
 * @example
 *   await expectVisible(terminal, "What can I do for you?");
 *   await expectVisible(terminal, ["/help", "/settings"], { timeout: 5000 });
 */
export async function expectVisible(
	terminal: Terminal,
	text: string | RegExp | (string | RegExp)[],
	options: { timeout?: number } = { timeout: maxTimeoutMs },
): Promise<void> {
	const items = Array.isArray(text) ? text : [text]
	await Promise.all(
		items.map((t) => {
			// tui-test uses String.prototype.matchAll internally, which requires
			// the global flag on RegExp arguments. Ensure it is set.
			if (t instanceof RegExp && !t.flags.includes("g")) {
				t = new RegExp(t.source, `${t.flags}g`)
			}
			const locator = terminal.getByText(t, {
				full: true,
				strict: false,
			})
			return expect(locator).toBeVisible(options.timeout !== undefined ? { timeout: options.timeout } : undefined)
		}),
	)
}

/**
 * Type text into the terminal and press Enter.
 * Waits `delay` ms between writing and submitting to let the UI settle.
 */
export async function typeAndSubmit(terminal: Terminal, text: string, delay = 500): Promise<void> {
	terminal.write(text)
	await new Promise((resolve) => setTimeout(resolve, delay))
	terminal.submit()
}
