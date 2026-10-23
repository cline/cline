import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installAbortSignalTimeout } from "./polyfills";

const ENTRY_PATH = fileURLToPath(new URL("../index.js", import.meta.url).href);

describe("installAbortSignalTimeout", () => {
	it("installs a signal that aborts after the delay", async () => {
		const host = {
			AbortSignal: {} as { timeout?: unknown },
			AbortController,
			setTimeout: (callback: () => void) => setTimeout(callback, 0),
		};

		expect(installAbortSignalTimeout(host)).toBe(true);
		const timeout = host.AbortSignal.timeout as (delay: number) => AbortSignal;
		const signal = timeout(5);
		expect(signal.aborted).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 1));
		expect(signal.aborted).toBe(true);
	});

	it("leaves a native implementation alone", () => {
		const native = vi.fn();
		const host = { AbortSignal: { timeout: native }, AbortController };

		expect(installAbortSignalTimeout(host)).toBe(false);
		expect(host.AbortSignal.timeout).toBe(native);
	});

	it("does nothing without AbortController to build the signal from", () => {
		const host = { AbortSignal: {} as { timeout?: unknown } };
		expect(installAbortSignalTimeout(host)).toBe(false);
		expect(host.AbortSignal.timeout).toBeUndefined();
	});
});

describe("index.js polyfill ordering", () => {
	const source = readFileSync(ENTRY_PATH, "utf8");

	/**
	 * The bug this guards: an `if (...)` polyfill written inline in `index.js` runs
	 * AFTER the hoisted `import "expo-router/entry"`, so the app graph is already
	 * evaluated by then. Only a side-effecting module import, placed before the
	 * entry import, runs first.
	 */
	it("imports the polyfill module before expo-router/entry", () => {
		const randomValues = source.indexOf('"react-native-get-random-values"');
		const polyfills = source.indexOf('"./src/polyfills"');
		const entry = source.indexOf('"expo-router/entry"');

		expect(randomValues).toBeGreaterThanOrEqual(0);
		expect(polyfills).toBeGreaterThan(randomValues);
		expect(entry).toBeGreaterThan(polyfills);
	});

	it("keeps no inline conditional polyfill, which would run too late", () => {
		expect(source).not.toMatch(/AbortSignal\.timeout\s*=/);
		expect(source).not.toMatch(/^\s*if\s*\(/m);
	});
});
