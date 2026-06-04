// ---------------------------------------------------------------------------
// Terminal interaction helpers for TUI tests.
//
// These wrap common tui-test patterns to keep test bodies readable.
// ---------------------------------------------------------------------------

import { expect } from "@microsoft/tui-test";
import type { Terminal } from "@microsoft/tui-test/lib/terminal/term";
import { EXIT_CODE_TIMEOUT } from "./constants.js";

// ---------------------------------------------------------------------------
// Core wait / assertion helpers
// ---------------------------------------------------------------------------

const maxTimeoutMs = 10_000;

/**
 * Internal helper – asserts visibility (or not) for one or more patterns.
 */
async function expectTextVisibility(
	terminal: Terminal,
	text: string | RegExp | (string | RegExp)[],
	visible: boolean,
	options: { timeout?: number } = { timeout: maxTimeoutMs },
): Promise<void> {
	const items = Array.isArray(text) ? text : [text];
	const timeoutOpt =
		options.timeout !== undefined ? { timeout: options.timeout } : undefined;
	await Promise.all(
		items.map((t) => {
			// tui-test uses String.prototype.matchAll internally, which requires
			// the global flag on RegExp arguments. Ensure it is set.
			if (t instanceof RegExp && !t.flags.includes("g")) {
				t = new RegExp(t.source, `${t.flags}g`);
			}
			const locator = terminal.getByText(t, {
				full: true,
				strict: false,
			});
			return visible
				? expect(locator).toBeVisible(timeoutOpt)
				: expect(locator).not.toBeVisible(timeoutOpt);
		}),
	);
}

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
	return expectTextVisibility(terminal, text, true, options);
}

export async function expectExitCode(
	terminal: Terminal,
	exitCode: number,
): Promise<void> {
	const xCode = await waitForTerminalExit(terminal);
	expect(xCode).toBe(exitCode);
}

/**
 * Assert that one or more text strings/regexes are **not** visible on screen.
 *
 * @example
 *   await expectNotVisible(terminal, "Loading…");
 *   await expectNotVisible(terminal, ["/secret", /error/i], { timeout: 5000 });
 */
export async function expectNotVisible(
	terminal: Terminal,
	text: string | RegExp | (string | RegExp)[],
	options: { timeout?: number } = { timeout: maxTimeoutMs },
): Promise<void> {
	return expectTextVisibility(terminal, text, false, options);
}

/**
 * Type text into the terminal and press Enter.
 * Waits `delay` ms between writing and submitting to let the UI settle.
 */
export async function typeAndSubmit(
	terminal: Terminal,
	text: string,
	delay = 500,
): Promise<void> {
	terminal.write(text);
	await new Promise((resolve) => setTimeout(resolve, delay));
	terminal.submit();
}

/**
 * Gracefully shut down the CLI process by sending Ctrl+C (SIGINT) and
 * waiting for the process to actually exit.
 *
 * This is necessary for VCR recording tests because tui-test normally
 * terminates processes with SIGKILL (signal 9), which cannot be caught
 * and prevents `process.on('exit')` handlers from flushing recorded
 * HTTP interactions to disk. Sending SIGINT first triggers the CLI's
 * graceful shutdown path which flushes VCR cassettes before exiting.
 *
 * @param timeout Maximum ms to wait for exit before giving up (default 5000)
 */
export async function gracefulShutdown(terminal: Terminal): Promise<number> {
	terminal.keyCtrlC();
	return await waitForTerminalExit(terminal);
}

export async function waitForTerminalExit(
	terminal: Terminal,
	timeout = 31000,
): Promise<number> {
	return await new Promise<number>((resolve) => {
		let resolved = false;
		const done = (code: number) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			clearInterval(poller);
			resolve(code);
		};

		const timer = setTimeout(() => done(EXIT_CODE_TIMEOUT), timeout); // exit code 124 is timeout

		// Register listener for future exit events
		terminal.onExit((exitResult) => done(exitResult.exitCode));

		// Poll terminal.exitResult as a fallback for the race condition where
		// the process exits before onExit listener is registered (the event
		// fires once and is not replayed for late subscribers).
		const poller = setInterval(() => {
			if (terminal.exitResult) {
				done(terminal.exitResult.exitCode);
			}
		}, 1000);
	});
}
