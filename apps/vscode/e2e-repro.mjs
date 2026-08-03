// Launch local VSCodium with the Cline extension, open the sidebar, capture errors.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { _electron } from "playwright"

const VSCODIUM = "C:/Program Files/VSCodium/VSCodium.exe"
const EXT_DEV = "C:/Users/14977/source/repos/cline/apps/vscode"
const WORKSPACE = "C:/Users/14977/source/repos/cline"
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-e2e-profile-"))

console.log("userDataDir:", userDataDir)

const app = await _electron.launch({
	executablePath: VSCODIUM,
	args: [
		`--extensionDevelopmentPath=${EXT_DEV}`,
		"--disable-extensions",
		"--disable-workspace-trust",
		"--no-sandbox",
		"--disable-updates",
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-gpu",
		`--user-data-dir=${userDataDir}`,
		WORKSPACE,
	],
	env: {
		...process.env,
		IS_DEV: "true",
		TEMP_PROFILE: "true",
		DEV_WORKSPACE_FOLDER: EXT_DEV,
		CLINE_ENVIRONMENT: "production",
		CLINE_DIR: "C:/Users/14977/.cline",
	},
	timeout: 120_000,
})

const page = await app.firstWindow()
console.log("Window ready")

page.on("pageerror", (err) => console.log("[PAGEERROR]", err.message, err.stack?.split("\n").slice(0, 5).join(" | ")))

await page.waitForTimeout(6000)

// Open the Cline sidebar tab (same approach as the debug harness)
try {
	const tab = page.getByRole("tab", { name: /Cline/ })
	if (await tab.count()) {
		await tab.locator("a").click()
		console.log("Clicked Cline sidebar tab")
	} else {
		// Fallback: command palette
		await page.keyboard.press("Meta+Shift+p")
		await new Promise((r) => setTimeout(r, 500))
		await page.keyboard.type("Cline: Focus on Cline View")
		await new Promise((r) => setTimeout(r, 300))
		await page.keyboard.press("Enter")
		console.log("Used command palette fallback")
	}
} catch (e) {
	console.log("Sidebar open failed:", e.message)
}

await page.waitForTimeout(18000)
await page.screenshot({ path: "C:/Users/14977/AppData/Local/Temp/opencode/e2e-shot2.png" }).catch(() => {})

// Read logs
const logsDir = path.join(userDataDir, "logs")
if (fs.existsSync(logsDir)) {
	const latest = fs.readdirSync(logsDir).sort().at(-1)
	console.log("latest log session:", latest)
	if (latest) {
		const exthostPath = path.join(logsDir, latest, "window1", "exthost", "exthost.log")
		if (fs.existsSync(exthostPath)) {
			const lines = fs.readFileSync(exthostPath, "utf8").split("\n")
			console.log("=== exthost.log relevant lines ===")
			for (const line of lines) if (/error|TypeError|Cannot/i.test(line)) console.log(line)
		}
		const clinePath = path.join(logsDir, latest, "window1", "exthost", "saoudrizwan.claude-dev", "Cline.log")
		if (fs.existsSync(clinePath)) {
			console.log("=== Cline.log tail ===")
			console.log(fs.readFileSync(clinePath, "utf8").split("\n").slice(-25).join("\n"))
		}
	}
}

await app.close().catch(() => {})
console.log("DONE")
