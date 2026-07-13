import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface MirroredPreviewEvent {
	moduleId: string
	cellId?: string
	kind: string
	payloadJson: string
	source: string
}

const evidenceE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase0-trust-identity-"))
		const workspaceDir = path.join(root, "workspace")
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
		if (!pythonInterpreter) throw new Error("AIHYDRO_E2E_PYTHON must select the deterministic interpreter")
		mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true })
		writeFileSync(
			path.join(workspaceDir, ".vscode", "settings.json"),
			JSON.stringify({
				"aihydro.htmlPreview.pythonExecution": "always",
				"aihydro.htmlPreview.pythonInterpreter": pythonInterpreter,
				"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
			}),
		)

		try {
			await use(workspaceDir)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

const untrustedE2E = evidenceE2E.extend<{ workspaceTrust: "enabled" }>({
	workspaceTrust: "enabled",
})

evidenceE2E.setTimeout(180_000)
evidenceE2E.skip(!process.env.AIHYDRO_E2E_PYTHON, "Phase 0 identity/event evidence requires AIHYDRO_E2E_PYTHON")

async function waitForFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>): Promise<Frame> {
	let match: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue
					try {
						if (await predicate(frame)) {
							match = frame
							return true
						}
					} catch {
						// The preview shell can replace frames during initialization.
					}
				}
				return false
			},
			{ timeout: 60_000 },
		)
		.toBe(true)
	return match as Frame
}

async function openGoldenModule(page: Page): Promise<Frame> {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
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
	for (const segment of ["phase0", "golden-course", "01-runtime-contract"]) {
		const item = explorer.getByRole("treeitem", { name: segment, exact: true }).last()
		await item.waitFor({ state: "visible", timeout: 10_000 })
		if ((await item.getAttribute("aria-expanded")) !== "true") {
			await item.click()
			await page.keyboard.press("ArrowRight")
		}
	}
	await explorer.getByRole("treeitem", { name: "module.html", exact: true }).first().dblclick()
	return waitForFrame(
		page,
		async (frame) => (await frame.locator('[data-aihydro-cell-id="fixture-state-create"]').count()) === 1,
	)
}

async function runCell(frame: Frame, cellId: string): Promise<void> {
	const run = frame.locator(`[data-aihydro-cell-id="${cellId}"] .aihydro-run`)
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	await run.evaluate((element: HTMLElement) => element.click())
}

function readMirroredEvents(homeDir: string, moduleId: string): MirroredPreviewEvent[] {
	const dir = path.join(homeDir, ".aihydro", "preview_events", moduleId)
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as MirroredPreviewEvent)
}

evidenceE2E(
	"HTML Preview exposes one canonical module identity and current event evidence @phase0-trust-identity-full",
	async ({ page, homeDir }) => {
		const artifact = await openGoldenModule(page)
		await runCell(artifact, "fixture-state-create")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')).toContainText(
			"ending_storage=110.0 mm",
			{ timeout: 60_000 },
		)
		await runCell(artifact, "fixture-error")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-error"] .aihydro-output')).toContainText(
			"intentional runtime-contract fixture error",
			{ timeout: 30_000 },
		)
		await artifact.getByLabel("90 mm").check()
		await artifact.getByRole("button", { name: "Check answers" }).click()
		await expect(artifact.locator("#quizScore")).toHaveText("0 / 1 correct")

		const canonicalId = "runtime-contract-01"
		const sessionDir = path.join(homeDir, ".aihydro", "preview_session")
		const eventRoot = path.join(homeDir, ".aihydro", "preview_events")
		await expect
			.poll(
				() =>
					existsSync(sessionDir)
						? readdirSync(sessionDir)
								.filter((name) => name.endsWith(".json"))
								.sort()
						: [],
				{
					timeout: 15_000,
				},
			)
			.toEqual([`${canonicalId}.json`])
		await expect
			.poll(() => (existsSync(eventRoot) ? readdirSync(eventRoot).sort() : []), { timeout: 15_000 })
			.toEqual([canonicalId])

		let events: MirroredPreviewEvent[] = []
		const expectedKinds = [
			"manifest.loaded",
			"cell.registry",
			"cell.run.started",
			"cell.run.completed",
			"cell.error",
			"user.interaction",
		]
		await expect
			.poll(
				() => {
					events = readMirroredEvents(homeDir, canonicalId)
					const kinds = new Set(events.map((event) => event.kind))
					return expectedKinds.every((kind) => kinds.has(kind))
				},
				{ timeout: 15_000 },
			)
			.toBe(true)

		for (const event of events) {
			expect(event.moduleId).toBe(canonicalId)
			const payload = JSON.parse(event.payloadJson) as { moduleId?: string; module_id?: string }
			if (payload.moduleId) expect(payload.moduleId).toBe(canonicalId)
			if (payload.module_id) expect(payload.module_id).toBe(canonicalId)
		}
		const startedSources = events
			.filter((event) => event.kind === "cell.run.started" && event.cellId === "fixture-state-create")
			.map((event) => event.source)
		expect(startedSources).toContain("user")
		expect(startedSources).toContain("kernel")
		expect(events.some((event) => /course.*progress|progress.*course/i.test(event.kind))).toBe(false)
	},
)

untrustedE2E(
	"HTML Preview keeps static content readable while untrusted Python is visibly denied @phase0-trust-identity-full @phase0-trust-smoke",
	async ({ page }) => {
		await expect(page.getByText("Restricted Mode", { exact: true }).first()).toBeVisible({ timeout: 20_000 })

		const artifact = await openGoldenModule(page)
		await expect(artifact.getByRole("heading", { name: "Interactive Module Contract Fixture" })).toBeVisible()
		const shell = await waitForFrame(page, async (frame) => (await frame.title()) === "AI-Hydro HTML Preview")
		await expect(shell.getByText("Workspace is not trusted — Python execution is disabled.")).toBeVisible()
		await runCell(artifact, "fixture-state-create")
		await expect(artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')).toContainText(
			"Python execution was denied",
			{ timeout: 30_000 },
		)
		await expect(artifact.getByRole("heading", { name: "Interactive Module Contract Fixture" })).toBeVisible()
	},
)
