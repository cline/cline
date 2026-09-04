#!/usr/bin/env bun

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startLocalCloudEnvironment } from "../test/cloud/local-cloud-environment"

const accessToken = "local-cloud-development-token"
const clineDir = await mkdtemp(path.join(tmpdir(), "cline-local-cloud-profile-"))
const dataDir = path.join(clineDir, "data")
const settingsDir = path.join(dataDir, "settings")
await mkdir(settingsDir, { recursive: true })
await writeFile(
	path.join(settingsDir, "providers.json"),
	JSON.stringify({
		version: 1,
		lastUsedProvider: "cline",
		providers: {
			cline: {
				provider: "cline",
				auth: {
					accessToken: `workos:${accessToken}`,
					accountId: "local-cloud-user",
					expiresAt: Date.now() + 24 * 60 * 60 * 1000,
				},
			},
		},
	}),
)
const environment = await startLocalCloudEnvironment({ port: 7777, accessToken })

console.log("Local cloud sessions fixture is ready.")
console.log(`API: ${environment.apiBaseUrl}`)
console.log(`Token: ${environment.accessToken}`)
console.log(`CLINE_DIR: ${clineDir}`)
console.log("")
console.log("Launch the extension host with:")
console.log(`  CLINE_ENVIRONMENT=local CLINE_CLOUD_SESSIONS=1 CLINE_DIR=${clineDir} CLINE_DATA_DIR=${dataDir}`)
console.log("The fixture accepts only loopback connections and blocks unexpected model requests.")
console.log("Press Ctrl-C to dispose all sandboxes and exit.")

let disposing = false
async function dispose(): Promise<void> {
	if (disposing) return
	disposing = true
	await environment.dispose()
	await rm(clineDir, { recursive: true, force: true })
	process.exit(0)
}

process.on("SIGINT", () => void dispose())
process.on("SIGTERM", () => void dispose())
