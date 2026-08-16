// ---------------------------------------------------------------------------
// Terminal interaction helpers for TUI tests.
//
// These wrap common tui-test patterns to keep test bodies readable.
// ---------------------------------------------------------------------------

import {
	ExpectationError,
	type TuiTest as Terminal,
} from "@microsoft/tui-test";
import { EXIT_CODE_TIMEOUT } from "./constants.js";
import { getProgramExitCode } from "./program-exit.js";

// ---------------------------------------------------------------------------
// Core wait / assertion helpers
// ---------------------------------------------------------------------------

const maxTimeoutMs = 30_000;

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
			const pattern = t instanceof RegExp ? regexSource(t) : t;
			return terminal.expectText(pattern, {
				regex: t instanceof RegExp,
				full: true,
				strict: false,
				not: !visible,
				timeout: timeoutOpt?.timeout,
			});
		}),
	);
}

function regexSource(regex: RegExp): string {
	const flags = ["i", "m", "s"].filter((flag) => regex.flags.includes(flag));
	return flags.length > 0
		? `(?${flags.join("")})${regex.source}`
		: regex.source;
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
	await terminal.waitExit({ timeout: 31_000 });
	const actualExitCode =
		getProgramExitCode(terminal) ?? (await terminal.state()).exited;
	if (actualExitCode !== exitCode) {
		throw new Error(
			`Expected terminal to exit with ${exitCode}, received ${actualExitCode}`,
		);
	}
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
	await terminal.type(text);
	await new Promise((resolve) => setTimeout(resolve, delay));
	await terminal.submit();
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
	await terminal.press("Ctrl+C");
	return await waitForTerminalExit(terminal);
}

export async function waitForTerminalExit(
	terminal: Terminal,
	timeout = 31000,
): Promise<number> {
	try {
		await terminal.waitExit({ timeout });
	} catch (error) {
		if (error instanceof ExpectationError) {
			return EXIT_CODE_TIMEOUT;
		}
		throw error;
	}
	return (
		getProgramExitCode(terminal) ??
		(await terminal.state()).exited ??
		EXIT_CODE_TIMEOUT
	);
}
