import { describe, expect, it, vi } from "vitest"
import {
	buildKanbanSpawnOptions,
	forwardSignalToKanbanProcess,
	hasUsedLegacyCli,
	shouldDetachKanbanProcess,
	shouldLaunchKanbanByDefault,
	shouldShowKanbanMigrationAnnouncement,
} from "./kanban"

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

describe("kanban process launch", () => {
	it("detaches the kanban process on unix-like platforms", () => {
		expect(shouldDetachKanbanProcess("darwin")).toBe(true)
		expect(shouldDetachKanbanProcess("linux")).toBe(true)
	})

	it("keeps the kanban process attached on windows", () => {
		expect(shouldDetachKanbanProcess("win32")).toBe(false)
	})

	it("uses a detached process group by default on unix-like platforms", () => {
		expect(buildKanbanSpawnOptions({}, "darwin")).toMatchObject({
			stdio: "inherit",
			detached: true,
		})
	})

	it("does not detach the process on windows", () => {
		expect(buildKanbanSpawnOptions({}, "win32")).toMatchObject({
			stdio: "inherit",
			detached: false,
		})
	})
})

describe("forwardSignalToKanbanProcess", () => {
	it("signals the detached kanban process group on unix-like platforms", () => {
		const killProcess = vi.fn()
		const child = {
			pid: 4321,
			kill: vi.fn(),
		}

		forwardSignalToKanbanProcess({
			child,
			signal: "SIGINT",
			platform: "darwin",
			killProcess,
		})

		expect(killProcess).toHaveBeenCalledWith(-4321, "SIGINT")
		expect(child.kill).not.toHaveBeenCalled()
	})

	it("signals the child process directly on windows", () => {
		const killProcess = vi.fn()
		const child = {
			pid: 4321,
			kill: vi.fn(),
		}

		forwardSignalToKanbanProcess({
			child,
			signal: "SIGTERM",
			platform: "win32",
			killProcess,
		})

		expect(killProcess).not.toHaveBeenCalled()
		expect(child.kill).toHaveBeenCalledWith("SIGTERM")
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
