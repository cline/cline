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

for (const legacyFile of ["globalState.json", "secrets.json"]) {
	const path = join(dataDir, legacyFile);
	console.log(
		`${legacyFile.padEnd(18)} ${existsSync(path) ? readFileSync(path, "utf8").trim() : "(absent)"}`,
	);
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
console.log(`\n${JSON.stringify(state.providers, null, 2)}`);
