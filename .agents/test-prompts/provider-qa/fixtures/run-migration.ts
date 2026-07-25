/**
 * Triggers the legacy provider-settings migration headlessly and prints the
 * result, so a tester can confirm what the migration produced before spending
 * time driving the UI.
 *
 * `ProviderSettingsManager` migrates on construction, so constructing it is the
 * whole test:
 *
 *   bun .agents/test-prompts/provider-qa/fixtures/run-migration.ts /tmp/cline-qa/data
 *
 * `@cline/core` is imported through its built `dist/` by path rather than by
 * package name, because this file lives outside the SDK workspace and would
 * otherwise not resolve. Run `bun run build:sdk` first if the import fails.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const { ProviderSettingsManager } = await import(
	join(repoRoot, "sdk/packages/core/dist/index.js")
);

const dataDir = process.argv[2];
if (!dataDir) {
	console.error("usage: run-migration.ts <dataDir>");
	process.exit(1);
}

const filePath = join(dataDir, "settings", "providers.json");

// Credential values never reach stdout: with `seed-legacy-config.mjs --key` or
// real QA keys, printing them verbatim would leak into CI logs and transcripts.
const SECRET_KEY_PATTERN = /(key|secret|token|credential|password)$/i;
function redact(key: string, value: unknown): unknown {
	return SECRET_KEY_PATTERN.test(key) &&
		typeof value === "string" &&
		value.length > 0
		? `(redacted, ${value.length} chars)`
		: value;
}

for (const legacyFile of ["globalState.json", "secrets.json"]) {
	const path = join(dataDir, legacyFile);
	let summary = "(absent)";
	if (existsSync(path)) {
		try {
			summary = JSON.stringify(JSON.parse(readFileSync(path, "utf8")), redact);
		} catch {
			summary = "(unparseable)";
		}
	}
	console.log(`${legacyFile.padEnd(18)} ${summary}`);
}
console.log(
	`\nproviders.json before migration: ${existsSync(filePath) ? "present" : "absent"}`,
);

const manager = new ProviderSettingsManager({ filePath, dataDir });
const state = manager.read();

console.log(
	`providers.json after migration : ${existsSync(filePath) ? "present" : "absent"}`,
);
console.log(
	`lastUsedProvider               : ${state.lastUsedProvider ?? "(none)"}`,
);
console.log(`\n${JSON.stringify(state.providers, redact, 2)}`);
