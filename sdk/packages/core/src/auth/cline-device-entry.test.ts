/**
 * The `@cline/core/auth/cline-device` entry is consumed by React Native (Metro),
 * which cannot resolve `node:` specifiers. `bun.mts` builds it with
 * `target: "node"` like every other entrypoint, so the bundler itself would
 * happily emit `node:crypto`/`node:http` — today they only disappear because the
 * Node-only code paths tree-shake away.
 *
 * A regression here would otherwise show up as a Metro *resolve* error inside the
 * mobile app, so assert on the emitted bundle. `bun.mts` runs the same assertion
 * at build time; this keeps it covered by the test suite too.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BUNDLE_PATH = fileURLToPath(
	new URL("../../dist/auth/cline-device-entry.js", import.meta.url).href,
);

const NODE_SPECIFIER_PATTERN = /["'`]node:[a-z_/.-]+["'`]/g;

describe("auth/cline-device-entry emitted bundle", () => {
	it("has been built", () => {
		// CI runs `bun run build:sdk` before the suite; locally run
		// `bun -F @cline/core build` first.
		expect(
			existsSync(BUNDLE_PATH),
			`Missing ${BUNDLE_PATH}. Run \`bun -F @cline/core build\` first.`,
		).toBe(true);
	});

	it("imports no node builtins", () => {
		const source = readFileSync(BUNDLE_PATH, "utf8");
		const offenders = [
			...new Set(source.match(NODE_SPECIFIER_PATTERN) ?? []),
		].sort();
		expect(offenders).toEqual([]);
	});
});
