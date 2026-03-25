import { describe, expect, it } from "vitest"
import { hasUsedLegacyCli, shouldLaunchKanbanByDefault, shouldShowKanbanMigrationAnnouncement } from "./kanban"

describe("shouldLaunchKanbanByDefault", () => {
	it("launches kanban for a bare interactive run", () => {
		expect(
			shouldLaunchKanbanByDefault({
				stdinWasPiped: false,
			}),
		).toBe(true)
	})

	it("does not launch kanban when a prompt is provided", () => {
		expect(
			shouldLaunchKanbanByDefault({
				prompt: "fix the tests",
				stdinWasPiped: false,
			}),
		).toBe(false)
	})

	it("does not launch kanban when stdin is piped", () => {
		expect(
			shouldLaunchKanbanByDefault({
				stdinWasPiped: true,
			}),
		).toBe(false)
	})

	it("does not launch kanban when the legacy tui is requested", () => {
		expect(
			shouldLaunchKanbanByDefault({
				stdinWasPiped: false,
				tui: true,
			}),
		).toBe(false)
	})
})

describe("hasUsedLegacyCli", () => {
	it("treats task history as legacy usage", () => {
		expect(
			hasUsedLegacyCli({
				taskHistoryCount: 1,
				isNewUser: true,
				welcomeViewCompleted: undefined,
				hasConfiguredAuth: false,
			}),
		).toBe(true)
	})

	it("treats configured auth as legacy usage", () => {
		expect(
			hasUsedLegacyCli({
				taskHistoryCount: 0,
				isNewUser: true,
				welcomeViewCompleted: undefined,
				hasConfiguredAuth: true,
			}),
		).toBe(true)
	})

	it("skips the announcement for fresh installs", () => {
		expect(
			hasUsedLegacyCli({
				taskHistoryCount: 0,
				isNewUser: true,
				welcomeViewCompleted: undefined,
				hasConfiguredAuth: false,
			}),
		).toBe(false)
	})
})

describe("shouldShowKanbanMigrationAnnouncement", () => {
	it("shows the announcement once for legacy users", () => {
		expect(
			shouldShowKanbanMigrationAnnouncement({
				announcementShown: false,
				hasUsedLegacyCli: true,
			}),
		).toBe(true)
	})

	it("does not show the announcement twice", () => {
		expect(
			shouldShowKanbanMigrationAnnouncement({
				announcementShown: true,
				hasUsedLegacyCli: true,
			}),
		).toBe(false)
	})
})
