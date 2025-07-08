import { SilentReporter, downloadAndUnzipVSCode } from "@vscode/test-electron"
import { execa } from "execa"

const TIMEOUT_MINUTE = 1
const INSTALL_TIMEOUT_MS = TIMEOUT_MINUTE * 60 * 1000

async function installVSCode(): Promise<string> {
	const VSCODE_APP_TYPE: "stable" | "insiders" = "stable"
	console.log("Downloading VS Code...")
	return await downloadAndUnzipVSCode(VSCODE_APP_TYPE, undefined, new SilentReporter())
}

async function installChromium(): Promise<void> {
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

async function installDependencies(): Promise<unknown> {
	return Promise.all([installVSCode(), installChromium()])
}

async function main(): Promise<void> {
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
