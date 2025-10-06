import { spawnSync } from "node:child_process"
import os from "node:os"
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") {
		return true
	}
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

function macStore(service: string, account: string, value: string): boolean {
	// delete first for idempotency
	spawnSync("security", ["delete-generic-password", "-a", account, "-s", service], { stdio: "ignore" })
	const res = spawnSync("security", ["add-generic-password", "-a", account, "-s", service, "-w", value, "-U"], {
		stdio: "ignore",
	})
	return res.status === 0
}
function macGet(service: string, account: string): string | undefined {
	const res = spawnSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], { encoding: "utf8" })
	return res.status === 0 ? res.stdout.trim() : undefined
}
function macDelete(service: string, account: string): boolean {
	const res = spawnSync("security", ["delete-generic-password", "-a", account, "-s", service], { stdio: "ignore" })
	return res.status === 0
}

// Linux/Windows helpers removed for now since test is macOS-only

// Extension-host validation of OS keychain commands

e2e("Secrets - OS keychain get/store/delete (macOS only)", async () => {
	const platform = os.platform()
	const service = "cline"
	const key = `e2e_secret_${Date.now()}`
	const value = "test-secret"

	if (platform !== "darwin") {
		console.warn("Skipping: test is macOS-only for now")
		return
	}
	if (!hasCommand("security")) {
		console.warn("Skipping: security CLI not available on macOS runner")
		return
	}

	// Ensure clean slate
	macDelete(service, key)

	// Store
	const stored = macStore(service, key, value)
	expect(stored).toBeTruthy()

	// Get
	const fetched = macGet(service, key)
	expect(fetched).toBe(value)

	// Delete
	const deleted = macDelete(service, key)
	expect(deleted).toBeTruthy()

	const after = macGet(service, key)
	expect(after).toBeUndefined()
})

// Standalone deps warning moved to standalone-migration.test.ts
