import { expect } from "@playwright/test"
import fs from "fs/promises"
import path from "path"
import { e2e, E2ETestHelper } from "./utils/helpers"

// This spec runs against its own fixture workspace, which ships two project
// skills (.cline/skills/aws-deploy, .cline/skills/ship-it) and one workflow
// (.clinerules/workflows/release-notes.md), so the slash menu has runtime
// commands to list without polluting the shared workspace fixture.
const skillsE2e = e2e.extend({
	workspaceDir: async ({}, use) => {
		await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace-skills"))
	},
})

skillsE2e(
	"Slash menu - lists workspace skills and workflows, inserts the skill token",
	async ({ helper, sidebar, page, workspaceDir }, testInfo) => {
		// Watcher discovery of a skill written mid-test needs more than the 20s default.
		testInfo.setTimeout(90_000)
		const freshSkillDir = path.join(workspaceDir, ".cline", "skills", "fresh-skill")
		await fs.rm(freshSkillDir, { recursive: true, force: true })

		try {
			await helper.signin(sidebar)

			const inputbox = sidebar.getByTestId("chat-input")
			await expect(inputbox).toBeVisible()
			const menu = sidebar.getByTestId("slash-commands-menu")

			// Typing "/" opens the menu with the built-ins, a Skills group, and a Workflow group.
			await inputbox.fill("/")
			await expect(menu).toBeVisible()
			await expect(menu.getByText("Default Commands", { exact: true })).toBeVisible()
			await expect(menu.getByText("/newtask", { exact: true })).toBeVisible()
			await expect(menu.getByText("Skills", { exact: true })).toBeVisible({ timeout: 15_000 })
			await expect(menu.getByText("/aws-deploy", { exact: true })).toBeVisible()
			await expect(menu.getByText("Deploy the sandbox app to AWS", { exact: false })).toBeVisible()
			// Frontmatter name "Ship It" is offered as the normalized token core resolves.
			await expect(menu.getByText("/ship-it", { exact: true })).toBeVisible()
			await expect(menu.getByText("Workflow Commands", { exact: true })).toBeVisible()
			await expect(menu.getByText("/release-notes", { exact: true })).toBeVisible()
			// The menu is a 200px scroll box; bring the skill and workflow groups into view for the screenshot.
			await menu.getByText("/release-notes", { exact: true }).scrollIntoViewIfNeeded()
			const { height } = await page.evaluate(() => ({ height: window.innerHeight }))
			await page.screenshot({
				path: path.join(E2ETestHelper.getResultsDir(testInfo.title), "slash-menu-skills.png"),
				clip: { x: 0, y: Math.max(0, height - 620), width: 500, height: 600 },
			})

			// Skills come after the built-ins and before workflows.
			const rows = await menu.locator(".slash-command-menu-item .font-bold").allInnerTexts()
			expect(rows.indexOf("/aws-deploy")).toBeGreaterThan(rows.indexOf("/newtask"))
			expect(rows.indexOf("/aws-deploy")).toBeLessThan(rows.indexOf("/release-notes"))

			// The typed prefix filters the menu down to the skill.
			await inputbox.fill("/aws")
			await expect(menu.getByText("/aws-deploy", { exact: true })).toBeVisible()
			await expect(menu.getByText("/newtask", { exact: true })).not.toBeVisible()
			await expect(menu.getByText("/release-notes", { exact: true })).not.toBeVisible()

			// Selecting the skill inserts its token and the input highlights it as a known command.
			await menu.getByText("/aws-deploy", { exact: true }).click()
			await expect(inputbox).toHaveValue("/aws-deploy ")
			await expect(sidebar.locator("mark.mention-context-textarea-highlight", { hasText: "/aws-deploy" })).toBeVisible()
			await inputbox.pressSequentially("to staging")
			await expect(inputbox).toHaveValue("/aws-deploy to staging")
			await page.screenshot({
				path: path.join(E2ETestHelper.getResultsDir(testInfo.title), "slash-skill-inserted.png"),
				clip: { x: 0, y: Math.max(0, height - 320), width: 500, height: 300 },
			})

			// A skill installed while the window is open shows up on a later menu open:
			// the host's file watcher discovers it and the menu re-fetches when it opens.
			await fs.mkdir(freshSkillDir, { recursive: true })
			await fs.writeFile(
				path.join(freshSkillDir, "SKILL.md"),
				"---\nname: fresh-skill\ndescription: Installed while the window was open.\n---\n\nSay hello.\n",
			)
			await expect
				.poll(
					async () => {
						await inputbox.fill("")
						await inputbox.fill("/fresh")
						return await menu.getByText("/fresh-skill", { exact: true }).isVisible()
					},
					{ timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
				)
				.toBe(true)
		} finally {
			await fs.rm(freshSkillDir, { recursive: true, force: true })
		}
	},
)
