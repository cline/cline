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

interface BookModuleRuntimeContract {
	id: string
	title: string
	stateCellId: string
	stateOutput: (string | RegExp)[]
	plotCellId: string
	errorCellId: string
	errorOutput: (string | RegExp)[]
	recoveryCellId: string
	recoveryOutput: (string | RegExp)[]
}

const BOOK_MODULES: readonly BookModuleRuntimeContract[] = [
	{
		id: "hmfp.water-balance.01",
		title: "Close a Watershed Water Balance",
		stateCellId: "hmfp.water-balance.01.state-create",
		stateOutput: ["ending_storage=109.0 mm", "109"],
		plotCellId: "hmfp.water-balance.01.state-read-plot",
		errorCellId: "hmfp.water-balance.01.intentional-error",
		errorOutput: ["intentional unit-mismatch diagnostic"],
		recoveryCellId: "hmfp.water-balance.01.error-recovery",
		recoveryOutput: ["recovered_after_error=True"],
	},
	{
		id: "hmfp.depth-volume-discharge.02",
		title: "Convert Depth, Volume, and Discharge",
		stateCellId: "hmfp.depth-volume-discharge.02.state-create",
		stateOutput: ["volume=36000 m^3", "interval_mean_discharge=2.000 m^3/s", "recovered_depth=3.600 mm"],
		plotCellId: "hmfp.depth-volume-discharge.02.state-read-plot",
		errorCellId: "hmfp.depth-volume-discharge.02.intentional-error",
		errorOutput: ["intentional duration-unit diagnostic"],
		recoveryCellId: "hmfp.depth-volume-discharge.02.error-recovery",
		recoveryOutput: ["recovered_after_error=True", "interval_mean_discharge=2.000 m^3/s"],
	},
	{
		id: "hmfp.unit-hydrograph-convolution.03",
		title: "Build and Convolve a Unit Hydrograph",
		stateCellId: "hmfp.unit-hydrograph-convolution.03.state-create",
		stateOutput: [
			"unit_hydrograph=0.6944, 1.3889, 0.6944",
			"direct_runoff=1.3889, 3.4722, 2.7778, 0.6944",
			"expected_volume=30000 m^3",
			"routed_volume=30000 m^3",
		],
		plotCellId: "hmfp.unit-hydrograph-convolution.03.state-read-plot",
		errorCellId: "hmfp.unit-hydrograph-convolution.03.intentional-error",
		errorOutput: ["intentional convolution-tail diagnostic", "loses 2500 m^3"],
		recoveryCellId: "hmfp.unit-hydrograph-convolution.03.error-recovery",
		recoveryOutput: ["recovered_after_error=True", "causal_delayed_response=True", "volume_alone_detects_early_shift=False"],
	},
] as const

const expectedModuleIndex = BOOK_MODULES.findIndex(({ id }) => id === expectedBookModuleId)
if (expectedModuleIndex < 0) {
	throw new Error(`No real-panel contract is registered for ${expectedBookModuleId}`)
}

async function completeCurrentAndOpenNext(page: Page, nextTitle: string): Promise<void> {
	const shell = await waitForCourseShell(page)
	const complete = shell.getByTitle("Mark complete & continue to next module")
	await expect(complete).toBeVisible({ timeout: 30_000 })
	await complete.evaluate((element: HTMLElement) => element.click())
	const next = shell.getByTitle(`Next: ${nextTitle}`)
	await expect(next).toBeEnabled({ timeout: 30_000 })
	await next.evaluate((element: HTMLElement) => element.click())
}

async function executeBookModule(
	page: Page,
	contract: BookModuleRuntimeContract,
): Promise<{ artifact: Frame; plotCell: Locator }> {
	const artifact = await waitForCellFrame(page, contract.stateCellId)
	const stateOutput = await runCell(artifact, contract.stateCellId)
	for (const expected of contract.stateOutput) {
		await expect(stateOutput).toContainText(expected, { timeout: 60_000 })
	}

	await runCell(artifact, contract.plotCellId)
	const plotCell = artifact.locator(`[data-aihydro-cell-id="${contract.plotCellId}"]`)
	await expectPng(plotCell)

	const errorOutput = await runCell(artifact, contract.errorCellId)
	for (const expected of contract.errorOutput) {
		await expect(errorOutput).toContainText(expected, { timeout: 30_000 })
	}
	const recoveryOutput = await runCell(artifact, contract.recoveryCellId)
	for (const expected of contract.recoveryOutput) {
		await expect(recoveryOutput).toContainText(expected, { timeout: 30_000 })
	}
	return { artifact, plotCell }
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

		for (const [index, contract] of BOOK_MODULES.slice(0, expectedModuleIndex + 1).entries()) {
			await completeCurrentAndOpenNext(page, contract.title)
			const { artifact, plotCell } = await executeBookModule(page, contract)
			if (index === 0) {
				const shell = await waitForCourseShell(page)
				await shell.getByTitle("More actions").evaluate((element: HTMLElement) => element.click())
				const restart = shell.locator('[role="menu"] button').filter({ hasText: "Restart kernel" })
				await expect(restart).toBeVisible()
				await restart.evaluate((element: HTMLElement) => element.click())
				const clearedOutput = await runCell(artifact, contract.plotCellId)
				await expect(clearedOutput).toContainText(/residual|not defined/, { timeout: 30_000 })

				const recreatedOutput = await runCell(artifact, contract.stateCellId)
				for (const expected of contract.stateOutput) {
					await expect(recreatedOutput).toContainText(expected, { timeout: 60_000 })
				}
				await runCell(artifact, contract.plotCellId)
				await expectPng(plotCell)
			}
		}
	},
)
