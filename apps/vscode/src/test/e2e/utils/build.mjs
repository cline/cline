/**
 * Script to install dependencies for running E2E tests in GitHub Actions.
 */
import { existsSync, rmSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { execa } from "execa"

const TIMEOUT_MINUTE = 5
const INSTALL_TIMEOUT_MS = TIMEOUT_MINUTE * 60 * 1000
// build.mjs lives at apps/vscode/src/test/e2e/utils — four levels up is apps/vscode
const CODEBASE_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const VSCODE_CACHE_DIR = path.join(CODEBASE_ROOT_DIR, ".vscode-test")

async function installVSCode() {
	const VSCODE_APP_TYPE = "stable"
	console.log("Downloading VS Code...")
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const executablePath = await downloadAndUnzipVSCode(VSCODE_APP_TYPE, undefined, new SilentReporter())
		if (existsSync(executablePath)) {
			console.log(`VS Code ready at ${executablePath}`)
			return executablePath
		}
		console.warn(`VS Code executable missing at ${executablePath}; clearing ${VSCODE_CACHE_DIR} and re-downloading`)
		rmSync(VSCODE_CACHE_DIR, { recursive: true, force: true })
	}
	throw new Error("VS Code executable not found after re-download")
}

async function installChromium() {
	console.log("Installing Playwright Chromium...")
	try {
		await execa("npm", ["exec", "playwright", "install", "chromium"], {
			stdio: "inherit",
		})
		console.log("Playwright Chromium installation completed successfully")
	} catch (error) {
		throw new Error(`Failed to install Playwright Chromium: ${error}`)
	}
}

async function installDependencies() {
	return Promise.all([installVSCode(), installChromium()])
}

async function main() {
	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(() => reject(new Error("Installation timed out.")), INSTALL_TIMEOUT_MS),
	)
	await Promise.race([installDependencies(), timeoutPromise])
	console.log("Installation complete.")
	process.exit(0)
}

main().catch((error) => {
	console.error("Failed to install dependencies for E2E test", error)
	process.exit(1)
})
