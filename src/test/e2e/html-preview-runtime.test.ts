import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

const runtimeE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase0-workspace-"))
		const workspaceDir = path.join(root, "workspace")
		const baseWorkspace = path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace")
		const phase0Fixtures = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "fixtures", "html-preview")
		cpSync(baseWorkspace, workspaceDir, { recursive: true })
		mkdirSync(path.join(workspaceDir, "phase0"), { recursive: true })
		cpSync(path.join(phase0Fixtures, "golden-course"), path.join(workspaceDir, "phase0", "golden-course"), {
			recursive: true,
		})
		cpSync(path.join(phase0Fixtures, "standalone-module.html"), path.join(workspaceDir, "phase0", "standalone-module.html"))
		cpSync(path.join(phase0Fixtures, "interrupt-module.html"), path.join(workspaceDir, "phase0", "interrupt-module.html"))

		const pythonInterpreter = process.env.AIHYDRO_E2E_PYTHON
		if (!pythonInterpreter) {
			throw new Error("AIHYDRO_E2E_PYTHON must point to the deterministic test interpreter")
		}
		mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(workspaceDir, ".vscode", "settings.json"),
			JSON.stringify(
				{
					"aihydro.htmlPreview.pythonExecution": "always",
					"aihydro.htmlPreview.pythonInterpreter": pythonInterpreter,
					"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
				},
				null,
				2,
			),
		)

		try {
			await use(workspaceDir)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

runtimeE2E.describe.configure({ mode: "serial" })
runtimeE2E.setTimeout(180_000)

async function openWorkspaceFile(page: Page, relativePath: string, confirmPlainHtml = false): Promise<void> {
	await page.waitForLoadState("domcontentloaded")
	await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
	await E2ETestHelper.openAiHydroSidebar(page)
	await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
	await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+E" : "Control+Shift+E")
	const explorer = page.locator(".part.sidebar.left")
	await explorer.waitFor({ state: "visible", timeout: 10_000 })
	const workspaceRoot = explorer.locator('[role="treeitem"][aria-level="1"]').first()
	if ((await workspaceRoot.count()) > 0 && (await workspaceRoot.getAttribute("aria-expanded")) !== "true") {
		await workspaceRoot.click()
		await page.keyboard.press("ArrowRight")
	}
	const segments = relativePath.split("/")
	for (const segment of segments.slice(0, -1)) {
		const item = explorer.getByRole("treeitem", { name: segment, exact: true }).last()
		await item.waitFor({ state: "visible", timeout: 10_000 })
		if ((await item.getAttribute("aria-expanded")) !== "true") {
			await item.click()
			await page.keyboard.press("ArrowRight")
		}
	}
	const file = explorer.getByRole("treeitem", { name: segments.at(-1), exact: true }).last()
	await file.waitFor({ state: "visible", timeout: 10_000 })
	if (confirmPlainHtml) {
		await file.dblclick()
		await page.keyboard.press("F1")
		const commandInput = page.locator(".quick-input-widget input")
		await commandInput.waitFor({ state: "visible", timeout: 10_000 })
		await page.keyboard.type("Add to AI-Hydro HTML Preview")
		await page.keyboard.press("Enter")
	} else {
		await file.dblclick()
	}
}

async function waitForFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>): Promise<Frame> {
	let match: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) {
						continue
					}
					try {
						if (await predicate(frame)) {
							match = frame
							return true
						}
					} catch {
						// Frames can be replaced while the preview shell refreshes.
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	return match as Frame
}

async function waitForShell(page: Page): Promise<Frame> {
	return waitForFrame(page, async (frame) => (await frame.title()) === "AI-Hydro HTML Preview")
}

async function waitForCellFrame(page: Page, cellId: string): Promise<Frame> {
	return waitForFrame(page, async (frame) => (await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1)
}

async function runCell(frame: Frame, cellId: string): Promise<void> {
	const cell = frame.locator(`[data-aihydro-cell-id="${cellId}"]`)
	const run = cell.locator(".aihydro-run")
	await expect(run).toBeVisible()
	// VS Code's built-in Chat pane and startup toasts can overlap a narrow
	// preview group on hosted macOS even though the iframe control is visible.
	await run.click({ force: true })
}

async function expectPngOutput(cell: Locator): Promise<void> {
	const image = cell.locator('.aihydro-output-images img[src^="data:image/png;base64,"]').first()
	await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/, { timeout: 60_000 })
	const source = await image.getAttribute("src")
	expect(source?.length ?? 0).toBeGreaterThan(1_000)
}

runtimeE2E("HTML Preview executes the golden runtime matrix @phase0-full", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())

	await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
	let shell = await waitForShell(page)
	await expect(shell.getByTitle("Course options")).toBeVisible({ timeout: 30_000 })
	const previewIframe = shell.locator("iframe").first()
	await expect(previewIframe).toHaveAttribute("srcdoc", /application\/vnd\.aihydro\.module\+json/)

	let artifact = await waitForCellFrame(page, "fixture-state-create")
	await runCell(artifact, "fixture-state-create")
	const stateOutput = artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')
	await expect(stateOutput).toContainText("ending_storage=110.0 mm", { timeout: 60_000 })
	await expect(stateOutput).toContainText("110.0")

	await runCell(artifact, "fixture-state-read-plot")
	const plotCell = artifact.locator('[data-aihydro-cell-id="fixture-state-read-plot"]')
	await expectPngOutput(plotCell)

	await runCell(artifact, "fixture-error")
	await expect(artifact.locator('[data-aihydro-cell-id="fixture-error"] .aihydro-output')).toContainText(
		"intentional runtime-contract fixture error",
		{ timeout: 30_000 },
	)
	await expect(shell.locator("iframe")).toBeVisible()

	await shell.getByTitle("More actions").click()
	await shell.getByRole("menuitem", { name: "Restart kernel" }).click()
	await runCell(artifact, "fixture-state-read-plot")
	await expect(plotCell.locator(".aihydro-output")).toContainText(/storage_next|not defined/, { timeout: 30_000 })
	await runCell(artifact, "fixture-state-create")
	await expect(stateOutput).toContainText("ending_storage=110.0 mm", { timeout: 30_000 })
	await runCell(artifact, "fixture-state-read-plot")
	await expectPngOutput(plotCell)

	await openWorkspaceFile(page, "phase0/interrupt-module.html")
	shell = await waitForShell(page)
	artifact = await waitForCellFrame(page, "interrupt-ready")
	await runCell(artifact, "interrupt-ready")
	await expect(artifact.locator('[data-aihydro-cell-id="interrupt-ready"] .aihydro-output')).toContainText(
		"interrupt_kernel_ready",
		{ timeout: 60_000 },
	)
	await runCell(artifact, "interrupt-sleep")
	const runningShell = await waitForFrame(page, async (frame) => (await frame.getByTitle("Interrupt execution").count()) === 1)
	const stop = runningShell.getByTitle("Interrupt execution")
	await expect(stop).toBeEnabled({ timeout: 30_000 })
	await stop.click()
	await expect(artifact.locator('[data-aihydro-cell-id="interrupt-sleep"] .aihydro-output')).toContainText(
		"Interrupted by user",
		{ timeout: 30_000 },
	)

	await openWorkspaceFile(page, "index.html", true)
	shell = await waitForShell(page)
	await waitForFrame(page, async (frame) => (await frame.getByRole("heading", { name: "Test Workspace" }).count()) === 1)
	await expect.poll(async () => shell.getByTitle("Course options").count()).toBe(0)

	await openWorkspaceFile(page, "phase0/standalone-module.html")
	artifact = await waitForCellFrame(page, "standalone-python")
	shell = await waitForShell(page)
	await expect.poll(async () => shell.getByTitle("Course options").count()).toBe(0)
	await runCell(artifact, "standalone-python")
	const standaloneOutput = artifact.locator('[data-aihydro-cell-id="standalone-python"] .aihydro-output')
	await expect(standaloneOutput).toContainText("standalone_execution=ok", { timeout: 30_000 })
	await expect(standaloneOutput).toContainText("42")
})

runtimeE2E("HTML Preview starts and executes a standalone module @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/standalone-module.html")
	const shell = await waitForShell(page)
	await expect(shell.locator("iframe").first()).toHaveAttribute("srcdoc", /standalone-runtime-fixture/, {
		timeout: 30_000,
	})
	const artifact = await waitForCellFrame(page, "standalone-python")
	await expect.poll(async () => shell.getByTitle("Course options").count()).toBe(0)
	await runCell(artifact, "standalone-python")
	const output = artifact.locator('[data-aihydro-cell-id="standalone-python"] .aihydro-output')
	await expect(output).toContainText("standalone_execution=ok", { timeout: 60_000 })
	await expect(output).toContainText("42")
})
