import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { expect } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

/**
 * Seeds an SDK session history record the way a completed task persists it
 * (~/.cline/data/sessions/<id>/<id>.json, snake_case on disk). `provider` is
 * the field the cost-display suppression keys on.
 */
function seedSessionRecord(
	clineDir: string,
	options: { id: string; provider: string; title: string; totalCost: number; ts: number },
): void {
	const { id, provider, title, totalCost, ts } = options
	const startedAt = new Date(ts).toISOString()
	const sessionDir = path.join(clineDir, "data", "sessions", id)
	mkdirSync(sessionDir, { recursive: true })
	writeFileSync(
		path.join(sessionDir, `${id}.json`),
		JSON.stringify({
			version: 1,
			session_id: id,
			source: "vscode",
			pid: 1,
			started_at: startedAt,
			ended_at: startedAt,
			exit_code: 0,
			status: "completed",
			interactive: true,
			provider,
			model: "test-model",
			cwd: "/tmp/e2e-history",
			workspace_root: "/tmp/e2e-history",
			enable_tools: true,
			enable_spawn: false,
			enable_teams: false,
			prompt: title,
			metadata: {
				title,
				isFavorited: false,
				size: 1024,
				totalCost,
				tokensIn: 100,
				tokensOut: 50,
				cacheWrites: 0,
				cacheReads: 0,
				modelId: "test-model",
				legacyTask: false,
			},
			updated_at: startedAt,
		}),
	)
	writeFileSync(path.join(sessionDir, `${id}.messages.json`), "[]")
}

e2e("History - hides cost estimates for subscription-billed tasks", async ({ app, page, helper, server: _server }) => {
	// Seed history BEFORE the webview loads so its first state fetch sees the
	// records (the extension caches history metadata for ~10s).
	const clineDir = await app.evaluate(() => process.env.CLINE_DIR)
	expect(clineDir).toBeTruthy()

	const now = Date.now()
	// openai-codex is marked usageCostDisplay = "subscription" in the SDK; its
	// stored totalCost is an API-rate estimate, not a real charge.
	seedSessionRecord(clineDir as string, {
		id: `${now - 1000}_subtask`,
		provider: "openai-codex",
		title: "Subscription billed e2e task",
		totalCost: 0.4242,
		ts: now - 1000,
	})
	// anthropic is usage-billed; its cost must keep rendering.
	seedSessionRecord(clineDir as string, {
		id: `${now - 2000}_apitask`,
		provider: "anthropic",
		title: "Usage billed e2e task",
		totalCost: 0.1337,
		ts: now - 2000,
	})

	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await helper.signin(sidebar)

	// Recent-task chips in the empty chat view (HistoryPreview)
	await expect(sidebar.getByText("Recent")).toBeVisible()
	await expect(sidebar.getByText("Subscription billed e2e task")).toBeVisible()
	await expect(sidebar.getByText("Usage billed e2e task")).toBeVisible()
	await expect(sidebar.getByText("$0.13")).toBeVisible()
	await expect(sidebar.getByText("$0.42")).not.toBeVisible()

	// Full history page (HistoryView) — scope to the virtualized list, since
	// the HistoryPreview beneath still holds matching task titles.
	await sidebar.getByRole("button", { name: "View all history" }).click()
	const historyList = sidebar.getByTestId("virtuoso-item-list")
	await expect(historyList.getByText("Subscription billed e2e task")).toBeVisible()
	await expect(historyList.getByText("Usage billed e2e task")).toBeVisible()
	await expect(historyList.getByText("$0.1337")).toBeVisible()
	await expect(historyList.getByText("$0.4242")).not.toBeVisible()
})
