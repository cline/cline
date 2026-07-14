import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"

const sourceArchive = process.env.AIHYDRO_PHASE1_PACK_PATH
const expectedBookModuleId = process.env.AIHYDRO_EXPECTED_BOOK_MODULE_ID ?? "hmfp.water-balance.01"
const courseEntryModuleId = "hmfp.orientation.00"

interface LifecycleSession {
	launch: () => Promise<{ app: ElectronApplication; page: Page }>
	close: () => Promise<number | null>
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

const artifactIntegrationE2E = e2e
	.extend<{ workspaceDir: string }>({
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
	.extend<{ lifecycle: LifecycleSession }>({
		lifecycle: async ({ openVSCode, workspaceDir, userDataDir, extensionsDir, homeDir }, use) => {
			let current: ElectronApplication | null = null
			const close = async () => {
				if (!current) return null
				const app = current
				current = null
				const pid = app.process().pid
				await E2ETestHelper.closeElectronApp(app)
				try {
					await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
				} catch {
					if (processIsRunning(pid)) app.process().kill()
					await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
				}
				return pid
			}
			let testFailure: unknown
			try {
				await use({
					launch: async () => {
						await close()
						current = await openVSCode(workspaceDir)
						const page = await current.firstWindow()
						await page.waitForLoadState("domcontentloaded")
						await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
						return { app: current, page }
					},
					close,
				})
			} catch (error) {
				testFailure = error
			}
			const cleanupFailures: unknown[] = []
			try {
				await close()
			} catch (error) {
				cleanupFailures.push(error)
			}
			const cleanupResults = await Promise.allSettled([
				E2ETestHelper.rmForRetries(userDataDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(extensionsDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(homeDir, { recursive: true, force: true }),
			])
			for (const result of cleanupResults) {
				if (result.status === "rejected") cleanupFailures.push(result.reason)
			}
			if (cleanupFailures.length > 0) {
				if (testFailure !== undefined) cleanupFailures.unshift(testFailure)
				throw new AggregateError(cleanupFailures, "Learning Pack real-panel teardown failed")
			}
			if (testFailure !== undefined) throw testFailure
		},
	})

artifactIntegrationE2E.setTimeout(300_000)
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
	{
		id: "hmfp.routing-method-comparison.04",
		title: "Compare Snyder, SCS, Clark, and ModClark Routing",
		stateCellId: "hmfp.routing-method-comparison.04.state-create",
		stateOutput: [
			"routing_methods=Snyder,SCS 484,Clark,ModClark-style",
			"storage_coefficient=1.00 h",
			"expected_volume=10000 m^3",
			"Clark: peak=1.2784 m^3/s; midpoint_centroid=2.000 h; volume=10000.0 m^3",
			"ModClark-style: peak=1.1711 m^3/s; midpoint_centroid=2.042 h; volume=10000.0 m^3",
		],
		plotCellId: "hmfp.routing-method-comparison.04.state-read-plot",
		errorCellId: "hmfp.routing-method-comparison.04.intentional-error",
		errorOutput: ["intentional cumulative-area diagnostic", "routes 45000 m^3 instead of 10000 m^3"],
		recoveryCellId: "hmfp.routing-method-comparison.04.error-recovery",
		recoveryOutput: [
			"recovered_after_error=True",
			"incremental_area_sum=1.000000",
			"all_methods_volume_conserving=True",
			"all_methods_nonnegative_on_nonnegative_time_grid=True",
		],
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

async function blockExternalNetwork(page: Page): Promise<void> {
	await page.route(/^https?:\/\//, async (route) => {
		const host = new URL(route.request().url()).hostname
		if (host === "127.0.0.1" || host === "localhost") await route.continue()
		else await route.abort("blockedbyclient")
	})
}

async function installBookPack(workspaceDir: string): Promise<string | undefined> {
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
	return commandResult.result?.status
}

interface PersistedCourseProgress {
	currentModuleId: string | null
	completed: Record<string, unknown>
}

function readOnlyCourseProgress(homeDir: string): PersistedCourseProgress {
	const directory = path.join(homeDir, ".aihydro", "course_progress")
	const files = readdirSync(directory).filter((entry) => entry.endsWith(".json"))
	expect(files).toHaveLength(1)
	return JSON.parse(readFileSync(path.join(directory, files[0]), "utf8")) as PersistedCourseProgress
}

async function interruptInstalledModule(page: Page, contract: BookModuleRuntimeContract, workspaceDir: string): Promise<void> {
	const artifact = await waitForCellFrame(page, contract.recoveryCellId)
	const cell = artifact.locator(`[data-aihydro-cell-id="${contract.recoveryCellId}"]`)
	const source = cell.locator(".aihydro-source")
	const original = await source.textContent()
	const originalTemplate = await cell.getAttribute("data-source-template")
	const startedPath = path.join(workspaceDir, ".aihydro-installed-pack-interrupt-started")
	rmSync(startedPath, { force: true })
	const slowCode = [
		"import time",
		"from pathlib import Path",
		`Path(${JSON.stringify(startedPath)}).write_text("started", encoding="utf-8")`,
		'print("installed_pack_interrupt_started", flush=True)',
		"time.sleep(30)",
		'print("installed_pack_interrupt_finished", flush=True)',
	].join("\n")
	// The deterministic slow source exists only in this live artifact frame. The
	// signed archive and installed files remain untouched, and the authored source
	// is restored before the recovery assertion below.
	try {
		await cell.evaluate((element, code) => {
			const sourceElement = element.querySelector(".aihydro-source")
			if (!sourceElement) throw new Error("Installed module cell source is missing")
			sourceElement.textContent = code
			element.setAttribute("data-source-template", code)
		}, slowCode)

		const output = await runCell(artifact, contract.recoveryCellId)
		await expect.poll(() => existsSync(startedPath), { timeout: 30_000 }).toBe(true)
		const runningShell = await waitForFrame(
			page,
			async (frame) => (await frame.getByTitle("Interrupt execution").count()) === 1,
		)
		const stop = runningShell.getByTitle("Interrupt execution")
		await expect(stop).toBeEnabled({ timeout: 30_000 })
		await stop.evaluate((element: HTMLElement) => element.click())
		await expect(output).toContainText("Interrupted by user", { timeout: 30_000 })
		await expect(output).not.toContainText("installed_pack_interrupt_finished")
		await expect.poll(() => runningShell.getByTitle("Interrupt execution").count(), { timeout: 20_000 }).toBe(0)
	} finally {
		rmSync(startedPath, { force: true })
		await cell.evaluate(
			(element, values) => {
				const sourceElement = element.querySelector(".aihydro-source")
				if (!sourceElement) throw new Error("Installed module cell source is missing")
				sourceElement.textContent = values.source
				if (values.template === null) element.removeAttribute("data-source-template")
				else element.setAttribute("data-source-template", values.template)
			},
			{ source: original ?? "", template: originalTemplate },
		)
	}
	await expect(cell.locator(".aihydro-run")).toBeEnabled({ timeout: 30_000 })
	const diagnostic = await runCell(artifact, contract.errorCellId)
	for (const expected of contract.errorOutput) {
		await expect(diagnostic).toContainText(expected, { timeout: 60_000 })
	}
	const recovered = await runCell(artifact, contract.recoveryCellId)
	for (const expected of contract.recoveryOutput) {
		await expect(recovered).toContainText(expected, { timeout: 60_000 })
	}
}

artifactIntegrationE2E(
	"executes a pinned book artifact, resumes after restart, and interrupts synthetic slow code @phase1-cross-repo",
	async ({ lifecycle, workspaceDir, homeDir }) => {
		let { app, page } = await lifecycle.launch()
		await blockExternalNetwork(page)
		await E2ETestHelper.openAiHydroSidebar(page)
		await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
		expect(await installBookPack(workspaceDir)).toBe("installed")

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

		const expectedProgress = {
			currentModuleId: BOOK_MODULES[expectedModuleIndex].id,
			completed: [courseEntryModuleId, ...BOOK_MODULES.slice(0, expectedModuleIndex).map(({ id }) => id)].sort(),
		}
		await expect
			.poll(() => {
				const progress = readOnlyCourseProgress(homeDir)
				return {
					currentModuleId: progress.currentModuleId,
					completed: Object.keys(progress.completed).sort(),
				}
			})
			.toEqual(expectedProgress)

		const firstPid = app.process().pid
		expect(await lifecycle.close()).toBe(firstPid)
		;({ app, page } = await lifecycle.launch())
		expect(app.process().pid).not.toBe(firstPid)
		await blockExternalNetwork(page)
		const restartedProgress = readOnlyCourseProgress(homeDir)
		expect(restartedProgress.currentModuleId).toBe(expectedProgress.currentModuleId)
		expect(Object.keys(restartedProgress.completed).sort()).toEqual(expectedProgress.completed)

		await E2ETestHelper.openAiHydroSidebar(page)
		await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
		expect(await installBookPack(workspaceDir)).toBe("noop")
		const resumedShell = await waitForCourseShell(page)
		await expect(
			resumedShell.getByTitle(`${expectedProgress.completed.length} of ${BOOK_MODULES.length + 1} modules completed`),
		).toBeVisible({ timeout: 30_000 })
		const resumedContract = BOOK_MODULES[expectedModuleIndex]
		const resumedArtifact = await waitForCellFrame(page, resumedContract.stateCellId)
		const clearedAfterRestart = await runCell(resumedArtifact, resumedContract.plotCellId)
		await expect(clearedAfterRestart).toContainText(/not defined/, { timeout: 30_000 })
		const recreatedAfterRestart = await runCell(resumedArtifact, resumedContract.stateCellId)
		for (const expected of resumedContract.stateOutput) {
			await expect(recreatedAfterRestart).toContainText(expected, { timeout: 60_000 })
		}
		await interruptInstalledModule(page, resumedContract, workspaceDir)
	},
)
