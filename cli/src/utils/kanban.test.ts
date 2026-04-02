import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
	buildKanbanInstallSpawnOptions,
	buildKanbanSpawnOptions,
	forwardSignalToKanbanProcess,
	hasUsedLegacyCli,
	isKanbanCommandAvailable,
	resolveKanbanInstallCommand,
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

	it("enables shell mode on windows for command launches", () => {
		expect(buildKanbanSpawnOptions({}, "win32")).toMatchObject({
			shell: true,
		})
	})

	it("does not set shell mode on unix-like platforms", () => {
		expect(buildKanbanSpawnOptions({}, "darwin")).not.toHaveProperty("shell")
	})
})

describe("kanban command availability", () => {
	it("returns false when PATH is empty", () => {
		expect(isKanbanCommandAvailable({ PATH: "" }, "darwin")).toBe(false)
	})

	it("detects the kanban command in PATH", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-cli-test-"))
		const commandPath = join(tempDirectory, process.platform === "win32" ? "kanban.cmd" : "kanban")
		writeFileSync(commandPath, process.platform === "win32" ? "@echo off\r\necho ok\r\n" : "#!/bin/sh\necho ok\n")
		if (process.platform !== "win32") {
			chmodSync(commandPath, 0o755)
		}

		try {
			expect(isKanbanCommandAvailable({ PATH: tempDirectory }, process.platform)).toBe(true)
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true })
		}
	})
})

describe("kanban install process launch", () => {
	it("does not detach the install process on unix-like platforms", () => {
		expect(buildKanbanInstallSpawnOptions({}, "darwin")).toMatchObject({
			stdio: "inherit",
			detached: false,
		})
	})

	it("enables shell mode on windows for npm.cmd launches", () => {
		expect(buildKanbanInstallSpawnOptions({}, "win32")).toMatchObject({
			shell: true,
		})
	})
})

describe("kanban installer resolution", () => {
	it("prefers npm when available", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-installer-test-"))
		writeFileSync(join(tempDirectory, "npm"), "#!/bin/sh\necho npm\n")
		writeFileSync(join(tempDirectory, "pnpm"), "#!/bin/sh\necho pnpm\n")
		writeFileSync(join(tempDirectory, "bun"), "#!/bin/sh\necho bun\n")
		chmodSync(join(tempDirectory, "npm"), 0o755)
		chmodSync(join(tempDirectory, "pnpm"), 0o755)
		chmodSync(join(tempDirectory, "bun"), 0o755)

		try {
			expect(resolveKanbanInstallCommand({ PATH: tempDirectory }, "darwin")?.packageManager).toBe("npm")
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true })
		}
	})

	it("falls back to pnpm when npm is unavailable", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-installer-test-"))
		writeFileSync(join(tempDirectory, "pnpm"), "#!/bin/sh\necho pnpm\n")
		chmodSync(join(tempDirectory, "pnpm"), 0o755)

		try {
			const installer = resolveKanbanInstallCommand({ PATH: tempDirectory }, "darwin")
			expect(installer?.packageManager).toBe("pnpm")
			expect(installer?.displayCommand).toBe("pnpm add -g kanban@latest")
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true })
		}
	})

	it("falls back to bun when npm and pnpm are unavailable", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "kanban-installer-test-"))
		writeFileSync(join(tempDirectory, "bun"), "#!/bin/sh\necho bun\n")
		chmodSync(join(tempDirectory, "bun"), 0o755)

		try {
			const installer = resolveKanbanInstallCommand({ PATH: tempDirectory }, "darwin")
			expect(installer?.packageManager).toBe("bun")
			expect(installer?.displayCommand).toBe("bun add -g kanban@latest")
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true })
		}
	})

	it("returns null when no supported package manager is available", () => {
		expect(resolveKanbanInstallCommand({ PATH: "" }, "darwin")).toBeNull()
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
