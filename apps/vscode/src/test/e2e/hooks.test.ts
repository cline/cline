import { expect } from "@playwright/test"
import fs from "fs/promises"
import path from "path"
import { E2ETestHelper, e2e } from "./utils/helpers"

// This spec runs against its own fixture workspace: hooks execute on every
// prompt once discovered (hooksEnabled defaults to true), so keeping the hook
// out of the shared workspace fixture spares every other prompt-sending spec
// the per-prompt hook spawn (a cold PowerShell start on Windows).
const hooksE2e = e2e.extend({
	workspaceDir: async ({}, use) => {
		await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace-hooks"))
	},
})

// The fixture ships a UserPromptSubmit hook
// (.clinerules/hooks/UserPromptSubmit[.ps1]) that writes hook-ran.json into its
// working directory, recording process.cwd() and the workspaceRoots it received
// on stdin. Discovery, cwd selection, and hook input metadata all resolve from
// the window's actual workspace folders, so the marker must land in this
// window's workspace root and name it — regardless of what any other Cline
// instance recorded in shared state.
hooksE2e("Hooks - workspace hook injects fresh context on each turn", async ({ helper, sidebar, workspaceDir }) => {
	const markerPath = path.join(workspaceDir, "hook-ran.json")
	await fs.rm(markerPath, { force: true })

	try {
		await helper.signin(sidebar)

		const inputbox = sidebar.getByTestId("chat-input")
		await expect(inputbox).toBeVisible()
		await inputbox.fill("hook context probe one")
		await sidebar.getByTestId("send-button").click()

		// The hook runs during beforeRun, ahead of the model call, so the
		// marker exists by the time the mock response renders.
		await expect(sidebar.getByText("Hook context received for turn one.").first()).toBeVisible()

		let markerRaw: string | undefined
		await expect
			.poll(
				async () => {
					markerRaw = await fs.readFile(markerPath, "utf-8").catch(() => undefined)
					return markerRaw
				},
				{ message: "workspace hook should have written hook-ran.json into the workspace root" },
			)
			.toBeDefined()
		const marker = JSON.parse(markerRaw ?? "{}")

		// Normalize with realpath: macOS reports temp/workspace paths under
		// /private while the fixture path may not carry the prefix.
		const expectedRoot = await fs.realpath(workspaceDir)
		expect(await fs.realpath(marker.cwd)).toBe(expectedRoot)

		expect(Array.isArray(marker.workspaceRoots)).toBe(true)
		const reportedRoots: string[] = []
		for (const root of marker.workspaceRoots) {
			reportedRoots.push(await fs.realpath(root))
		}
		expect(reportedRoots).toContain(expectedRoot)
		expect(marker.prompt).toContain("hook context probe one")

		await fs.rm(markerPath, { force: true })
		await inputbox.fill("hook context probe two")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("Hook context received for turn two.").first()).toBeVisible()
		const secondMarker = JSON.parse(await fs.readFile(markerPath, "utf-8"))
		expect(secondMarker.prompt).toContain("hook context probe two")
		expect(secondMarker.prompt).not.toContain("HOOK_FACT_")
		await expect(sidebar.getByText(/HOOK_FACT_(ALPHA|BETA)/)).toHaveCount(0)

		await sidebar.getByRole("button", { name: "New Task", exact: true }).first().click()
		await expect(sidebar.getByText("Recent")).toBeVisible()
		await sidebar.getByText("hook context probe one").first().click()
		await expect(sidebar.getByText("hook context probe two")).toBeVisible()
		await expect(sidebar.getByText(/HOOK_FACT_(ALPHA|BETA)/)).toHaveCount(0)
	} finally {
		await fs.rm(markerPath, { force: true })
	}
})
