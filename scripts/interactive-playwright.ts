#!/usr/bin/env npx tsx

/**
 * Interactive Playwright launcher for the Cline VS Code extension.
 *
 * What this script does:
 *  - Starts the mock Cline API server (from the e2e test fixture).
 *  - Downloads a stable build of VS Code (via @vscode/test-electron).
 *  - Creates a temporary VS Code user profile directory.
 *  - Launches VS Code with the Cline extension installed and development path linked.
 *  - Opens a test workspace and automatically shows the Cline sidebar.
 *  - Records **all gRPC calls** made during the session (for later inspection).
 *  - Keeps VS Code running for manual interactive testing until you close the window or press Ctrl+C.
 *  - Cleans up resources (mock server, temp profile, electron process) on exit.
 *
 * How to run:
 *   1. From the repo root, run:
 *
 *        npm run test:playwright:interactive
 *
 *   2. VS Code will launch with the Cline extension loaded.
 *   3. Interact with it manually; all gRPC calls will be recorded automatically.
 *   4. Close VS Code or press Ctrl+C when finished.
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
			GRPC_RECORDER_ENABLED: "false",
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
			console.log(`We could teardown iteractive playwright propery, error:${e}`)
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
