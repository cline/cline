#!/usr/bin/env bun

import { startLocalCloudDevelopment } from "./local-cloud-development"

const development = await startLocalCloudDevelopment()

let disposing = false
async function dispose(): Promise<void> {
	if (disposing) return
	disposing = true
	try {
		await development.dispose()
		process.exit(0)
	} catch (error) {
		console.error("Failed to dispose local cloud development resources:", error)
		process.exit(1)
	}
}

process.on("SIGINT", () => void dispose())
process.on("SIGTERM", () => void dispose())

console.log("Local cloud sessions fixture is ready.")
console.log(`API: ${development.environment.apiBaseUrl}`)
console.log(`Token: ${development.environment.accessToken}`)
console.log(`CLINE_DIR: ${development.clineDir}`)
console.log("")
console.log("Launch the extension host with:")
console.log(`  ${development.launchEnvironment}`)
console.log("The fixture accepts only loopback connections and blocks unexpected model requests.")
console.log("Press Ctrl-C to dispose all sandboxes and exit.")
