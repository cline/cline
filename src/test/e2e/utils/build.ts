import { SilentReporter, downloadAndUnzipVSCode } from "@vscode/test-electron"
import { spawn } from "node:child_process"

const VSCODE_APP_TYPE: "stable" | "insiders" = "stable"

export async function installVSCode(): Promise<string> {
	return await downloadAndUnzipVSCode(VSCODE_APP_TYPE, undefined, new SilentReporter())
}

export async function installChromium(): Promise<void> {
	const proc = spawn("npm", ["exec", "playwright", "install", "chromium"], {
		shell: true,
		stdio: "inherit",
	})

	return new Promise<void>((resolve, reject) => {
		proc.on("error", reject)
		proc.on("close", (code) => {
			console.log("Playwright Chromium installation process closed with code:", code)
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`Failed to install Playwright Chromium: ${code}`))
			}
		})
	})
}

export async function installDependencies(): Promise<void> {
	console.log("Download VS Code and installing Playwright Chromium...")
	await Promise.all([installVSCode(), installChromium()])
	console.log("Installation complete.")
}
