#!/usr/bin/env bun
/**
 * Regenerates `src/theme/tokens.ts` from the vendored `design/theme.css`
 * snapshot and refreshes the recorded SHA-256.
 *
 *   bun run scripts/generate-tokens.ts
 *   bun run tokens:generate
 *
 * To pull a newer upstream theme, replace `design/theme.css`, re-run this, and
 * review the resulting diff.
 *
 * `design/theme.css` is a byte-exact snapshot, so never run a formatter over it
 * - Biome's CSS formatter rewraps the multi-line font stacks and shadow lists,
 * which changes the hash without changing any token. `tokens:check` catches it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
	renderTokensModule,
	THEME_CSS_PATH,
	THEME_SHA_PATH,
	TOKENS_PATH,
} from "./lib/css-tokens";

function main(): void {
	const { source, hash } = renderTokensModule();

	const previous = (() => {
		try {
			return readFileSync(TOKENS_PATH, "utf8");
		} catch {
			return undefined;
		}
	})();

	writeFileSync(TOKENS_PATH, source);
	writeFileSync(THEME_SHA_PATH, `${hash}\n`);

	const label = relative(process.cwd(), TOKENS_PATH);
	if (previous === source) {
		console.log(`tokens: ${label} already up to date (sha256 ${hash})`);
	} else {
		console.log(
			`tokens: wrote ${label} from ${relative(process.cwd(), THEME_CSS_PATH)} (sha256 ${hash})`,
		);
	}
}

main();
