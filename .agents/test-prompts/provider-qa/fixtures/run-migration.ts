/**
 * Triggers the legacy provider-settings migration headlessly and prints the
 * result, so a tester can confirm what the migration produced before spending
 * time driving the UI.
 *
 * `ProviderSettingsManager` migrates on construction, so constructing it is the
 * whole test. Must be run from the SDK workspace root so `@cline/core` and its
 * transitive dependencies resolve:
 *
 *   cd /workspace/sdk
 *   bun ../.agents/test-prompts/provider-qa/fixtures/run-migration.ts /tmp/cline-qa/data
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ProviderSettingsManager } from "@cline/core"

const dataDir = process.argv[2]
if (!dataDir) {
	console.error("usage: run-migration.ts <dataDir>")
	process.exit(1)
}

const filePath = join(dataDir, "settings", "providers.json")

for (const legacyFile of ["globalState.json", "secrets.json"]) {
	const path = join(dataDir, legacyFile)
	console.log(`${legacyFile.padEnd(18)} ${existsSync(path) ? readFileSync(path, "utf8").trim() : "(absent)"}`)
}
console.log(`\nproviders.json before migration: ${existsSync(filePath) ? "present" : "absent"}`)

const manager = new ProviderSettingsManager({ filePath, dataDir })
const state = manager.read()

console.log(`providers.json after migration : ${existsSync(filePath) ? "present" : "absent"}`)
console.log(`lastUsedProvider               : ${state.lastUsedProvider ?? "(none)"}`)
console.log(`\n${JSON.stringify(state.providers, null, 2)}`)
