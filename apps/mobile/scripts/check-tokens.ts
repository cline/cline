#!/usr/bin/env bun
/**
 * Drift guard for the design-token pipeline. Exits non-zero when either:
 *
 *   1. `design/theme.css` no longer hashes to `design/theme.css.sha256`, or
 *   2. regenerating from that css produces something other than the committed
 *      `src/theme/tokens.ts`.
 *
 *   bun run scripts/check-tokens.ts
 *   bun run tokens:check
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
	renderTokensModule,
	sha256,
	THEME_CSS_PATH,
	THEME_SHA_PATH,
	TOKENS_PATH,
} from "./lib/css-tokens";

/** Unified diff of two texts, without shelling out to `diff`. */
function unifiedDiff(expected: string, actual: string, limit = 60): string[] {
	const expectedLines = expected.split("\n");
	const actualLines = actual.split("\n");
	const lines: string[] = [];

	for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
		const a = expectedLines[i];
		const b = actualLines[i];
		if (a === b) continue;
		if (a !== undefined) lines.push(`  -${i + 1}: ${a}`);
		if (b !== undefined) lines.push(`  +${i + 1}: ${b}`);
		if (lines.length >= limit) {
			lines.push("  ... (truncated)");
			break;
		}
	}

	return lines;
}

function main(): void {
	const problems: string[] = [];

	const recordedHash = readFileSync(THEME_SHA_PATH, "utf8").trim();
	const actualHash = sha256(readFileSync(THEME_CSS_PATH));
	if (recordedHash !== actualHash) {
		problems.push(
			[
				`${relative(process.cwd(), THEME_CSS_PATH)} does not match its recorded hash.`,
				`  recorded: ${recordedHash}`,
				`  actual:   ${actualHash}`,
				"  If the snapshot was intentionally updated, run: bun run tokens:generate",
			].join("\n"),
		);
	}

	// Regenerate into a temp file (never touching the committed output) and diff.
	const scratch = mkdtempSync(join(tmpdir(), "cline-mobile-tokens-"));
	try {
		const { source } = renderTokensModule();
		const candidate = join(scratch, "tokens.ts");
		writeFileSync(candidate, source);

		const committed = readFileSync(TOKENS_PATH, "utf8");
		const regenerated = readFileSync(candidate, "utf8");
		if (committed !== regenerated) {
			problems.push(
				[
					`${relative(process.cwd(), TOKENS_PATH)} is stale.`,
					...unifiedDiff(committed, regenerated),
					"  Run: bun run tokens:generate",
				].join("\n"),
			);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}

	if (problems.length > 0) {
		console.error(`tokens:check failed\n\n${problems.join("\n\n")}`);
		process.exit(1);
	}

	console.log(
		`tokens:check ok - ${relative(process.cwd(), TOKENS_PATH)} matches design/theme.css (sha256 ${actualHash})`,
	);
}

main();
