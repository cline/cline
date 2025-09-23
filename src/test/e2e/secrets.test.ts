import { spawnSync } from "node:child_process"
import os from "node:os"
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") return true
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

function linuxStore(service: string, account: string, value: string): boolean {
	const cmd = `printf %s ${JSON.stringify(value)} | secret-tool store --label=${JSON.stringify(service)} service ${JSON.stringify(
		service,
	)} account ${JSON.stringify(account)}`
	const res = spawnSync("sh", ["-c", cmd], { stdio: "ignore" })
	return res.status === 0
}
function linuxGet(service: string, account: string): string | undefined {
	const res = spawnSync("secret-tool", ["lookup", "service", service, "account", account], { encoding: "utf8" })
	return res.status === 0 ? res.stdout.trim() : undefined
}
function linuxDelete(service: string, account: string): boolean {
	const res = spawnSync("secret-tool", ["clear", "service", service, "account", account], { stdio: "ignore" })
	return res.status === 0
}

function winStore(service: string, account: string, value: string): boolean {
	// Requires CredentialManager module
	const ps = `New-StoredCredential -Target '${service}:${account}' -Username '${service}' -Password '${value}' -Persist LocalMachine -Type Generic`
	const res = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "ignore" })
	return res.status === 0
}
function winGet(service: string, account: string): string | undefined {
	const ps = `$c = Get-StoredCredential -Target '${service}:${account}'; if ($c) { Write-Output $c.Password }`
	const res = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8" })
	return res.status === 0 ? res.stdout.trim() : undefined
}
function winDelete(service: string, account: string): boolean {
	const ps = `Remove-StoredCredential -Target '${service}:${account}' -ErrorAction SilentlyContinue`
	const res = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "ignore" })
	return res.status === 0
}

// Extension-host validation of OS keychain commands

e2e("Secrets - OS keychain get/store/delete", async () => {
	const platform = os.platform()
	const service = "cline"
	const key = `e2e_secret_${Date.now()}`
	const value = "test-secret"

	if (platform === "darwin" && !hasCommand("security")) {
		console.warn("Skipping: security CLI not available on macOS runner")
		return
	}
	if (platform === "linux" && !hasCommand("secret-tool")) {
		console.warn("Skipping: secret-tool not available on Linux runner")
		return
	}
	if (platform === "win32") {
		const check = spawnSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				"if (Get-Module -ListAvailable -Name CredentialManager) { exit 0 } else { exit 1 }",
			],
			{ stdio: "ignore" },
		)
		if (check.status !== 0) {
			console.warn("Skipping: CredentialManager module not available on Windows runner")
			return
		}
	}

	// Ensure clean slate
	if (platform === "darwin") macDelete(service, key)
	if (platform === "linux") linuxDelete(service, key)
	if (platform === "win32") winDelete(service, key)

	// Store
	const stored =
		platform === "darwin"
			? macStore(service, key, value)
			: platform === "linux"
				? linuxStore(service, key, value)
				: winStore(service, key, value)
	expect(stored).toBeTruthy()

	// Get
	const fetched =
		platform === "darwin" ? macGet(service, key) : platform === "linux" ? linuxGet(service, key) : winGet(service, key)
	expect(fetched).toBe(value)

	// Delete
	const deleted =
		platform === "darwin"
			? macDelete(service, key)
			: platform === "linux"
				? linuxDelete(service, key)
				: winDelete(service, key)
	expect(deleted).toBeTruthy()

	const after =
		platform === "darwin" ? macGet(service, key) : platform === "linux" ? linuxGet(service, key) : winGet(service, key)
	expect(after).toBeUndefined()
})

// Standalone deps warning moved to standalone-migration.test.ts
