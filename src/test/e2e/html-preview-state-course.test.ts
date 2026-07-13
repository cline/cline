import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface LifecycleSession {
	launch: () => Promise<{ app: ElectronApplication; page: Page }>
	close: () => Promise<void>
}

const stateCourseE2E = e2e
	.extend<{ workspaceRoot: string }>({
		workspaceRoot: async ({}, use) => {
			const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase0-state-course-"))
			try {
				await use(root)
			} finally {
				rmSync(root, { recursive: true, force: true })
			}
		},
	})
	.extend<{ workspaceDir: string }>({
		workspaceDir: async ({ workspaceRoot }, use) => {
			const workspaceDir = path.join(workspaceRoot, "workspace")
			const baseWorkspace = path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace")
			const goldenCourse = path.join(
				E2ETestHelper.CODEBASE_ROOT_DIR,
				"src",
				"test",
				"fixtures",
				"html-preview",
				"golden-course",
			)
			cpSync(baseWorkspace, workspaceDir, { recursive: true })
			cpSync(goldenCourse, path.join(workspaceDir, "phase0", "golden-course"), { recursive: true })

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
			await use(workspaceDir)
		},
	})
	.extend<{ lifecycle: LifecycleSession }>({
		lifecycle: async ({ openVSCode, workspaceDir, userDataDir, extensionsDir, homeDir }, use) => {
			let current: ElectronApplication | null = null
			const close = async () => {
				if (current) {
					const app = current
					current = null
					let timer: NodeJS.Timeout | undefined
					const closed = await Promise.race([
						app
							.close()
							.then(() => true)
							.catch(() => true),
						new Promise<boolean>((resolve) => {
							timer = setTimeout(() => resolve(false), 15_000)
						}),
					])
					if (timer) {
						clearTimeout(timer)
					}
					if (!closed && app.process().exitCode === null) {
						app.process().kill()
					}
				}
			}
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
			await close()
			await Promise.allSettled([
				E2ETestHelper.rmForRetries(userDataDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(extensionsDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(homeDir, { recursive: true, force: true }),
			])
		},
	})

stateCourseE2E.describe.configure({ mode: "serial" })
stateCourseE2E.setTimeout(240_000)
stateCourseE2E.skip(
	!process.env.AIHYDRO_E2E_PYTHON,
	"Phase 0 lifecycle tests require AIHYDRO_E2E_PYTHON to select the deterministic test interpreter",
)

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
						// The preview shell and artifact frames are replaced during reloads.
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

async function hasArtifactCell(page: Page, cellId: string): Promise<boolean> {
	try {
		await expect
			.poll(
				async () => {
					for (const frame of page.frames()) {
						if (!frame.isDetached() && (await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1) {
							return true
						}
					}
					return false
				},
				{ timeout: 3_000 },
			)
			.toBe(true)
		return true
	} catch {
		return false
	}
}

async function showExplorer(page: Page): Promise<void> {
	const explorerTab = page.getByRole("tab", { name: /^Explorer/ })
	await explorerTab.click()
	const sidebar = page.locator(".part.sidebar.left")
	try {
		await sidebar.waitFor({ state: "visible", timeout: 2_000 })
	} catch {
		await page.getByRole("button", { name: /Toggle Primary Side Bar/ }).click()
	}
	await sidebar.waitFor({ state: "visible", timeout: 10_000 })
}

async function waitForCellFrame(page: Page, cellId: string): Promise<Frame> {
	return waitForFrame(page, async (frame) => (await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1)
}

async function openWorkspaceFile(page: Page, relativePath: string): Promise<void> {
	const expectedCellId = relativePath.includes("02-prerequisite-target") ? "fixture-unlocked-cell" : "fixture-state-create"
	await E2ETestHelper.openAiHydroSidebar(page)
	await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
	await showExplorer(page)
	await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
	await page.keyboard.press("W")
	await showExplorer(page)
	const explorer = page.locator(".part.sidebar.left")
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
	const matchingFiles = explorer.getByRole("treeitem", { name: segments.at(-1), exact: true })
	const file = relativePath.includes("02-prerequisite-target") ? matchingFiles.last() : matchingFiles.first()
	await file.waitFor({ state: "visible", timeout: 10_000 })
	await file.dblclick()
	if (await hasArtifactCell(page, expectedCellId)) {
		return
	}
	await page.getByRole("button", { name: "Open Quick Access" }).click()
	const commandInput = page.locator(".quick-input-widget input")
	await commandInput.waitFor({ state: "visible", timeout: 10_000 })
	await commandInput.fill(">Add to AI-Hydro HTML Preview")
	await page.keyboard.press("Enter")
}

async function runCell(frame: Frame, cellId: string): Promise<void> {
	const run = frame.locator(`[data-aihydro-cell-id="${cellId}"] .aihydro-run`)
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	await run.evaluate((element: HTMLElement) => element.click())
}

async function setStorage(frame: Frame, value: string): Promise<void> {
	const input = frame.locator("#fixture-storage")
	await input.evaluate((element: HTMLInputElement, nextValue) => {
		element.value = nextValue
		element.dispatchEvent(new Event("input", { bubbles: true }))
		element.dispatchEvent(new Event("change", { bubbles: true }))
	}, value)
	await expect(frame.locator('[data-aihydro-mirror="storage"]')).toHaveText(value)
	await expect.poll(async () => input.inputValue()).toBe(value)
}

async function useToolbarAction(shell: Frame, label: string): Promise<void> {
	const trigger = shell.getByTitle("More actions")
	await trigger.evaluate((element: HTMLElement) => element.click())
	await expect(trigger).toHaveAttribute("aria-expanded", "true")
	const item = shell.locator('[role="menu"] button').filter({ hasText: label })
	await expect(item).toBeVisible()
	await item.evaluate((element: HTMLElement) => element.click())
}

function progressPath(homeDir: string): string {
	return path.join(homeDir, ".aihydro", "course_progress", "aihydro-runtime-contract-fixture.json")
}

function completedModules(homeDir: string): string[] {
	try {
		const progress = JSON.parse(readFileSync(progressPath(homeDir), "utf8")) as { completed?: Record<string, unknown> }
		return Object.keys(progress.completed ?? {}).sort()
	} catch {
		return []
	}
}

function persistedStorage(homeDir: string): string | undefined {
	const directory = path.join(homeDir, ".aihydro", "module_state")
	try {
		for (const file of readdirSync(directory)) {
			const state = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as {
				values?: Record<string, string>
			}
			const value = state.values?.["fixture-state-create::storage"]
			if (value !== undefined) {
				return value
			}
		}
	} catch {
		// The directory does not exist until the debounced first write completes.
	}
	return undefined
}

stateCourseE2E(
	"HTML Preview separates control, course, and kernel lifecycles @phase0-state-course-full",
	async ({ lifecycle, homeDir }) => {
		let { page } = await lifecycle.launch()
		await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
		let shell = await waitForShell(page)
		let artifact = await waitForCellFrame(page, "fixture-state-create")

		const lockedNext = shell.getByTitle(/Locked — complete prerequisite/)
		await expect(lockedNext).toBeDisabled()
		await setStorage(artifact, "125")
		await expect.poll(() => persistedStorage(homeDir)).toBe("125")

		await useToolbarAction(shell, "Reload preview iframe")
		artifact = await waitForCellFrame(page, "fixture-state-create")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("125")

		shell = await waitForShell(page)
		await useToolbarAction(shell, "Remove this preview")
		await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
		shell = await waitForShell(page)
		artifact = await waitForCellFrame(page, "fixture-state-create")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("125")

		await runCell(artifact, "fixture-state-create")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')).toContainText(
			"ending_storage=135.0 mm",
			{ timeout: 60_000 },
		)
		await useToolbarAction(shell, "Restart kernel")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("125")
		await runCell(artifact, "fixture-state-read-plot")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-state-read-plot"] .aihydro-output')).toContainText(
			/storage_next|not defined/,
			{ timeout: 30_000 },
		)

		await runCell(artifact, "fixture-state-create")
		await setStorage(artifact, "130")
		await expect.poll(() => persistedStorage(homeDir)).toBe("130")
		await artifact.getByLabel("90 mm").check()
		await artifact.getByRole("button", { name: "Check answers" }).click()
		await expect(artifact.locator("#quizScore")).toContainText("0 / 1 correct")
		await expect(artifact.locator('.aihydro-quiz-feedback[data-fb="0"]')).toBeVisible()
		await expect.poll(() => completedModules(homeDir)).toEqual([])
		await expect(shell.getByTitle(/Locked — complete prerequisite/)).toBeDisabled()

		await artifact.getByLabel("110 mm").check()
		await artifact.getByRole("button", { name: "Check answers" }).click()
		await expect(artifact.locator("#quizScore")).toContainText("1 / 1 correct")
		await expect(artifact.locator('.aihydro-quiz-feedback[data-fb="1"]')).toBeVisible()
		await expect(artifact.locator("#quizScore")).toContainText("Correct: inputs are added and both losses are subtracted.")
		await expect.poll(() => completedModules(homeDir)).toEqual(["runtime-contract-01"])
		await expect(shell.getByTitle("1 of 2 modules completed")).toBeVisible({ timeout: 10_000 })
		const next = shell.getByTitle("Next: Prerequisite Target")
		await expect(next).toBeEnabled()
		await next.click()
		await waitForCellFrame(page, "fixture-unlocked-cell")

		await expect
			.poll(() => {
				const progress = JSON.parse(readFileSync(progressPath(homeDir), "utf8")) as {
					currentModuleId: string | null
					completed: Record<string, unknown>
				}
				return {
					currentModuleId: progress.currentModuleId,
					completed: Object.keys(progress.completed).sort(),
				}
			})
			.toEqual({ currentModuleId: "runtime-contract-02", completed: ["runtime-contract-01"] })

		await lifecycle.close()
		;({ page } = await lifecycle.launch())
		const persistedProgress = JSON.parse(readFileSync(progressPath(homeDir), "utf8")) as {
			currentModuleId: string | null
			completed: Record<string, unknown>
		}
		expect(persistedProgress.currentModuleId).toBe("runtime-contract-02")
		expect(Object.keys(persistedProgress.completed)).toEqual(["runtime-contract-01"])

		await openWorkspaceFile(page, "phase0/golden-course/02-prerequisite-target/module.html")
		shell = await waitForShell(page)
		await expect(shell.getByTitle("Previous: Runtime Contract")).toBeEnabled()
		await expect(shell.getByTitle("1 of 2 modules completed")).toBeVisible()

		await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
		shell = await waitForShell(page)
		artifact = await waitForCellFrame(page, "fixture-state-create")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("130")
		await runCell(artifact, "fixture-state-create")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')).toContainText(
			"ending_storage=140.0 mm",
			{ timeout: 60_000 },
		)

		await shell.getByTitle("Course options").evaluate((element: HTMLElement) => element.click())
		const resetProgress = shell.locator("button").filter({ hasText: "Reset progress (1 completed)" })
		await expect(resetProgress).toBeVisible()
		await resetProgress.evaluate((element: HTMLElement) => element.click())
		const confirmReset = shell.locator("button").filter({ hasText: /^Reset$/ })
		await expect(confirmReset).toBeVisible()
		await confirmReset.evaluate((element: HTMLElement) => element.click())
		await expect(shell.getByTitle("0 of 2 modules completed")).toBeVisible()
		await expect(shell.getByTitle(/Locked — complete prerequisite/)).toBeDisabled()
		await expect(artifact.locator("#fixture-storage")).toHaveValue("130")
		await runCell(artifact, "fixture-state-read-plot")
		await expect(
			artifact.locator('[data-aihydro-cell-id="fixture-state-read-plot"] img[src^="data:image/png;base64,"]'),
		).toHaveCount(1, { timeout: 60_000 })

		await useToolbarAction(shell, "Reset controls to defaults")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("100")
		await expect(shell.getByTitle("0 of 2 modules completed")).toBeVisible()
		await runCell(artifact, "fixture-state-read-plot")
		await expect(
			artifact.locator('[data-aihydro-cell-id="fixture-state-read-plot"] img[src^="data:image/png;base64,"]'),
		).toHaveCount(1, { timeout: 60_000 })
	},
)

stateCourseE2E(
	"HTML Preview restores control state after a full process restart @phase0-state-course-smoke",
	async ({ lifecycle, homeDir }) => {
		let { page } = await lifecycle.launch()
		await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
		let artifact = await waitForCellFrame(page, "fixture-state-create")
		await setStorage(artifact, "120")
		await expect.poll(() => persistedStorage(homeDir)).toBe("120")

		await lifecycle.close()
		;({ page } = await lifecycle.launch())
		await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
		artifact = await waitForCellFrame(page, "fixture-state-create")
		await expect(artifact.locator("#fixture-storage")).toHaveValue("120")
	},
)
