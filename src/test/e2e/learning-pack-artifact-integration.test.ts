import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

const sourceArchive = process.env.AIHYDRO_PHASE1_PACK_PATH
const expectedBookModuleId = process.env.AIHYDRO_EXPECTED_BOOK_MODULE_ID ?? "hmfp.water-balance.01"

const artifactIntegrationE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		if (!sourceArchive) throw new Error("AIHYDRO_PHASE1_PACK_PATH is required")
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase1-artifact-workspace-"))
		const workspace = path.join(root, "workspace")
		cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
		cpSync(sourceArchive, path.join(workspace, "book-student.aihydropack"))
		const pythonInterpreter = process.env.AIHYDRO_E2E_PYTHON
		if (!pythonInterpreter) throw new Error("AIHYDRO_E2E_PYTHON is required")
		mkdirSync(path.join(workspace, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(workspace, ".vscode", "settings.json"),
			JSON.stringify({
				"aihydro.htmlPreview.pythonExecution": "always",
				"aihydro.htmlPreview.pythonInterpreter": pythonInterpreter,
				"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
			}),
		)
		try {
			await use(workspace)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

artifactIntegrationE2E.setTimeout(180_000)
artifactIntegrationE2E.skip(!sourceArchive, "requires a pinned book-built Learning Pack artifact")

async function waitForFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>): Promise<Frame> {
	let result: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue
					try {
						if (await predicate(frame)) {
							result = frame
							return true
						}
					} catch {
						// VS Code replaces panel frames during registration and navigation.
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	return result as Frame
}

async function waitForCourseShell(page: Page): Promise<Frame> {
	return waitForFrame(
		page,
		async (frame) =>
			(await frame.title()) === "AI-Hydro HTML Preview" && (await frame.getByTitle("Course options").count()) === 1,
	)
}

async function waitForCellFrame(page: Page, cellId: string): Promise<Frame> {
	return waitForFrame(page, async (frame) => (await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1)
}

async function runCell(frame: Frame, cellId: string): Promise<Locator> {
	const cell = frame.locator(`[data-aihydro-cell-id="${cellId}"]`)
	const run = cell.locator(".aihydro-run")
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	await run.evaluate((element: HTMLElement) => element.click())
	return cell.locator(".aihydro-output")
}

async function expectPng(cell: Locator): Promise<void> {
	const image = cell.locator('.aihydro-output-images img[src^="data:image/png;base64,"]').first()
	await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/, { timeout: 60_000 })
	const source = await image.getAttribute("src")
	expect(source?.length ?? 0).toBeGreaterThan(1_000)
}

artifactIntegrationE2E(
	"installs a pinned book artifact and executes its authored runtime contract @phase1-cross-repo",
	async ({ page, workspaceDir }) => {
		await page.route(/^https?:\/\//, async (route) => {
			const host = new URL(route.request().url()).hostname
			if (host === "127.0.0.1" || host === "localhost") await route.continue()
			else await route.abort("blockedbyclient")
		})
		await E2ETestHelper.openAiHydroSidebar(page)
		await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
		let response: Response | undefined
		await expect
			.poll(
				async () => {
					try {
						response = await fetch("http://127.0.0.1:9876/learning-pack-command", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								command: "aihydro.learningPacks.install",
								options: {
									archivePath: path.join(workspaceDir, "book-student.aihydropack"),
									approval: "install-once",
									prereleaseOptIn: true,
								},
							}),
						})
						return response.status
					} catch {
						return 0
					}
				},
				{ timeout: 30_000 },
			)
			.toBe(200)
		const commandResult = (await response!.json()) as { result?: { status?: string } }
		expect(commandResult.result?.status).toBe("installed")

		let shell = await waitForCourseShell(page)
		await expect(shell.getByTitle("Course options")).toBeVisible({ timeout: 30_000 })
		const completeOrientation = shell.getByTitle("Mark complete & continue to next module")
		await expect(completeOrientation).toBeVisible({ timeout: 30_000 })
		await completeOrientation.evaluate((element: HTMLElement) => element.click())
		const nextModule = shell.getByTitle("Next: Close a Watershed Water Balance")
		await expect(nextModule).toBeEnabled({ timeout: 30_000 })
		await nextModule.evaluate((element: HTMLElement) => element.click())

		const artifact = await waitForCellFrame(page, "hmfp.water-balance.01.state-create")
		const stateOutput = await runCell(artifact, "hmfp.water-balance.01.state-create")
		await expect(stateOutput).toContainText("ending_storage=109.0 mm", { timeout: 60_000 })
		await expect(stateOutput).toContainText("109")

		await runCell(artifact, "hmfp.water-balance.01.state-read-plot")
		const plotCell = artifact.locator('[data-aihydro-cell-id="hmfp.water-balance.01.state-read-plot"]')
		await expectPng(plotCell)

		const errorOutput = await runCell(artifact, "hmfp.water-balance.01.intentional-error")
		await expect(errorOutput).toContainText("intentional unit-mismatch diagnostic", { timeout: 30_000 })
		const recoveryOutput = await runCell(artifact, "hmfp.water-balance.01.error-recovery")
		await expect(recoveryOutput).toContainText("recovered_after_error=True", { timeout: 30_000 })

		shell = await waitForCourseShell(page)
		await shell.getByTitle("More actions").evaluate((element: HTMLElement) => element.click())
		const restart = shell.locator('[role="menu"] button').filter({ hasText: "Restart kernel" })
		await expect(restart).toBeVisible()
		await restart.evaluate((element: HTMLElement) => element.click())
		const clearedOutput = await runCell(artifact, "hmfp.water-balance.01.state-read-plot")
		await expect(clearedOutput).toContainText(/residual|not defined/, { timeout: 30_000 })

		await runCell(artifact, "hmfp.water-balance.01.state-create")
		await runCell(artifact, "hmfp.water-balance.01.state-read-plot")
		await expectPng(plotCell)

		if (expectedBookModuleId === "hmfp.water-balance.01") return
		expect(expectedBookModuleId).toBe("hmfp.depth-volume-discharge.02")

		shell = await waitForCourseShell(page)
		const completeWaterBalance = shell.getByTitle("Mark complete & continue to next module")
		await expect(completeWaterBalance).toBeVisible({ timeout: 30_000 })
		await completeWaterBalance.evaluate((element: HTMLElement) => element.click())
		const nextConversion = shell.getByTitle("Next: Convert Depth, Volume, and Discharge")
		await expect(nextConversion).toBeEnabled({ timeout: 30_000 })
		await nextConversion.evaluate((element: HTMLElement) => element.click())

		const conversion = await waitForCellFrame(page, "hmfp.depth-volume-discharge.02.state-create")
		const conversionOutput = await runCell(conversion, "hmfp.depth-volume-discharge.02.state-create")
		await expect(conversionOutput).toContainText("volume=36000 m^3", { timeout: 60_000 })
		await expect(conversionOutput).toContainText("interval_mean_discharge=2.000 m^3/s")
		await expect(conversionOutput).toContainText("recovered_depth=3.600 mm")

		await runCell(conversion, "hmfp.depth-volume-discharge.02.state-read-plot")
		const conversionPlot = conversion.locator('[data-aihydro-cell-id="hmfp.depth-volume-discharge.02.state-read-plot"]')
		await expectPng(conversionPlot)

		const conversionError = await runCell(conversion, "hmfp.depth-volume-discharge.02.intentional-error")
		await expect(conversionError).toContainText("intentional duration-unit diagnostic", { timeout: 30_000 })
		const conversionRecovery = await runCell(conversion, "hmfp.depth-volume-discharge.02.error-recovery")
		await expect(conversionRecovery).toContainText("recovered_after_error=True", { timeout: 30_000 })
		await expect(conversionRecovery).toContainText("interval_mean_discharge=2.000 m^3/s")
	},
)
