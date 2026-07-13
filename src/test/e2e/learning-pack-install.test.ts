import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import {
	createLearningPackTestArchive,
	createValidLearningPackFiles,
	TEST_MODULE_IDS,
} from "../../services/learning-pack/__tests__/learningPackTestFixture"
import { E2ETestHelper, e2e } from "./utils/helpers"

const installedPackE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase1-pack-workspace-"))
		const workspace = path.join(root, "workspace")
		cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
		const entryHtml = Buffer.from(`<!doctype html><html><head>
			<meta http-equiv="Content-Security-Policy" content="default-src *">
			<script type="application/vnd.aihydro.module+json">${JSON.stringify({
				id: TEST_MODULE_IDS[0],
				title: "Synthetic installed pack",
				version: "0.1.0",
				authors: [{ name: "Synthetic Test" }],
				license: "CC-BY-4.0",
				requires: { executable: false, python: [] },
			})}</script>
			<script>window.inlineBridgeRan=true</script>
			<script src="https://phase1-csp.invalid/external.js"></script>
		</head><body data-phase1-installed-pack="true">
			<h1>Installed Learning Pack</h1>
			<img id="embedded" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
			<img id="external" src="https://phase1-csp.invalid/external.png">
		</body></html>`)
		const { files } = createValidLearningPackFiles({ firstModuleBytes: entryHtml })
		writeFileSync(path.join(workspace, "synthetic.aihydropack"), createLearningPackTestArchive(files))
		try {
			await use(workspace)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

async function waitForPreviewShell(page: Page): Promise<Frame> {
	let result: Frame | undefined
	await expect
		.poll(async () => {
			for (const frame of page.frames()) {
				try {
					if ((await frame.title()) === "AI-Hydro HTML Preview") {
						result = frame
						return true
					}
				} catch {
					// Panel frames are replaced during initial registration.
				}
			}
			return false
		}, { timeout: 30_000 })
		.toBe(true)
	return result as Frame
}

installedPackE2E("installs a local signed pack and enforces CSP through the real panel @phase1-pack", async ({
	page,
	workspaceDir,
}) => {
	let externalRequests = 0
	await page.route("https://phase1-csp.invalid/**", async (route) => {
		externalRequests++
		await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.externalScriptRan=true" })
	})
	await E2ETestHelper.openAiHydroSidebar(page)
	await expect
		.poll(async () => {
			for (const frame of page.frames()) {
				try {
					if ((await frame.title()).startsWith("AI-Hydro")) return true
				} catch {}
			}
			return false
		}, { timeout: 20_000 })
		.toBe(true)
	await page.waitForTimeout(1_000)
	const activationFailure = page.getByText(/Activating extension .* failed:/).first()
	expect(await activationFailure.count()).toBe(0)
	let commandResponse: Response | undefined
	await expect
		.poll(async () => {
			try {
				commandResponse = await fetch("http://127.0.0.1:9876/learning-pack-command", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						command: "aihydro.learningPacks.install",
						options: {
							archivePath: path.join(workspaceDir, "synthetic.aihydropack"),
							approval: "install-once",
						},
					}),
				})
				return commandResponse.status
			} catch {
				return 0
			}
		}, { timeout: 30_000 })
		.toBe(200)
	const commandResult = (await commandResponse!.json()) as { result?: { status?: string } }
	expect(commandResult.result?.status).toBe("installed")

	const shell = await waitForPreviewShell(page)
	const iframe = shell.locator("iframe").first()
	await expect(iframe).toHaveAttribute("srcdoc", /data-phase1-installed-pack="true"/, { timeout: 30_000 })
	const srcdoc = (await iframe.getAttribute("srcdoc")) ?? ""
	expect(srcdoc).toContain("default-src 'none'")
	expect(srcdoc).not.toContain("default-src *")
	expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(srcdoc.indexOf("<script"))
	await expect(shell.getByTitle("Course options")).toBeVisible()

	let artifact: Frame | undefined
	await expect
		.poll(async () => {
			artifact = page.frames().find((frame) => frame !== shell && frame.url() === "about:srcdoc")
			return Boolean(artifact)
		}, { timeout: 30_000 })
		.toBe(true)
	await expect.poll(() => artifact!.evaluate(() => (window as Window & { inlineBridgeRan?: boolean }).inlineBridgeRan)).toBe(true)
	expect(await artifact!.evaluate(() => (window as Window & { externalScriptRan?: boolean }).externalScriptRan)).not.toBe(true)
	await expect.poll(() => artifact!.locator("#embedded").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
	expect(await artifact!.locator("#external").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(0)
	expect(externalRequests).toBe(0)
})
