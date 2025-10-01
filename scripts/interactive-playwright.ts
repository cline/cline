#!/usr/bin/env npx tsx

/**
 * Interactive Playwright launcher for the Cline VS Code extension.
 *
 * Overview:
 *  - Starts the mock Cline API server (from the e2e test fixtures).
 *  - Downloads a stable build of VS Code (via @vscode/test-electron).
 *  - Creates a temporary VS Code user profile directory.
 *  - Installs and links the Cline extension (from dist/e2e.vsix and the dev path).
 *  - Opens a test workspace and automatically reveals the Cline sidebar.
 *  - Records **all gRPC calls** during the session for later inspection.
 *  - Keeps VS Code running for manual interactive testing until the window is closed or Ctrl+C is pressed.
 *  - Cleans up all resources (mock server, temp profile, Electron process) on exit.
 *
 * Usage:
 *   1. (Optional) Build and install the e2e extension:
 *        npm run test:e2e:build
 *
 *   2. From the repo root, start the interactive session:
 *        npm run test:playwright:interactive
 *
 *   3. VS Code will launch with the Cline extension loaded and gRPC recording enabled.
 *
 *   4. Interact with the extension manually.
 *
 *   5. Close the VS Code window or press Ctrl+C to end the session and trigger cleanup.
 */

import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { mkdtempSync } from "fs"
import os from "os"
import path from "path"
import { _electron } from "playwright"
import { ClineApiServerMock } from "../src/test/e2e/fixtures/server"
import { E2ETestHelper } from "../src/test/e2e/utils/helpers"

async function main() {
	await ClineApiServerMock.startGlobalServer()

	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "vsce-interactive"))
	const executablePath = await downloadAndUnzipVSCode("stable", undefined, new SilentReporter())

	// launch VSCode
	const app = await _electron.launch({
		executablePath,
		env: {
			...process.env,
			TEMP_PROFILE: "true",
			E2E_TEST: "true",
			CLINE_ENVIRONMENT: "local",
			GRPC_RECORDER_ENABLED: "true",
			GRPC_RECORDER_TESTS_FILTERS_ENABLED: "true",
		},
		args: [
			"--no-sandbox",
			"--disable-updates",
			"--disable-workspace-trust",
			"--disable-extensions",
			"--skip-welcome",
			"--skip-release-notes",
			`--user-data-dir=${userDataDir}`,
			`--install-extension=${path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
			`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`,
			path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"),
		],
	})

	const page = await app.firstWindow()

	await E2ETestHelper.openClineSidebar(page)

	console.log("VSCode with Cline extension is now running!")
	console.log(`Temporary data directory on: ${userDataDir}`)
	console.log("You can manually interact with the extension.")
	console.log("Press Ctrl+C to close when done.")

	async function teardown() {
		console.log("Cleaning up resources...")
		try {
			await app?.close()
			await ClineApiServerMock.stopGlobalServer?.()
			await E2ETestHelper.rmForRetries(userDataDir, { recursive: true })
		} catch (e) {
			console.log(`We could teardown interactive playwright properly, error:${e}`)
		}
		console.log("Finished cleaning up resources...")
	}

	process.on("SIGINT", async () => {
		await teardown()
		process.exit(0)
	})

	process.on("SIGTERM", async () => {
		await teardown()
		process.exit(0)
	})

	const win = await app.firstWindow()
	win.on("close", async () => {
		console.log("VS Code window closed.")
		await teardown()
		process.exit(0)
	})
	process.stdin.resume()
}

main().catch((err) => {
	console.error("Failed to start:", err)
	process.exit(1)
})
