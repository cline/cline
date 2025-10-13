import { ChildProcess, spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, test } from "@playwright/test"

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") {
		return true
	}
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

function setupTestKeychain(): { keychainPath: string; keychainPwd: string; cleanup: () => void } {
	const keychainPath = path.join(os.tmpdir(), `cline-tests-${Date.now()}-${Math.random().toString(36).slice(2)}.keychain-db`)
	const keychainPwd = "cline-test-pass"

	// Save original keychain search list to restore later (prevents system prompts)
	const originalKeychains = spawnSync("security", ["list-keychains", "-d", "user"], { encoding: "utf8" }).stdout

	// Create and configure test keychain
	spawnSync("security", ["create-keychain", "-p", keychainPwd, keychainPath], { stdio: "ignore" })
	spawnSync("security", ["set-keychain-settings", "-lut", "3600", keychainPath], { stdio: "ignore" })
	spawnSync("security", ["unlock-keychain", "-p", keychainPwd, keychainPath], { stdio: "ignore" })

	// Remove test keychain from search list to prevent system processes from accessing it
	const keychainList = originalKeychains
		.split("\n")
		.map((line) => line.trim().replace(/^"|"$/g, ""))
		.filter((line) => line.length > 0)
	if (keychainList.length > 0) {
		spawnSync("security", ["list-keychains", "-d", "user", "-s", ...keychainList], { stdio: "ignore" })
	}

	return {
		keychainPath,
		keychainPwd,
		cleanup: () => {
			spawnSync("security", ["delete-keychain", keychainPath], { stdio: "ignore" })
		},
	}
}

test.setTimeout(90000)

test("Standalone migration moves secrets.json to OS keychain and removes file (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	// Prepare isolated CLINE_DIR with legacy secrets.json
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-standalone-mig-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	const secretsPath = path.join(dataDir, "secrets.json")
	fs.writeFileSync(secretsPath, JSON.stringify({ openRouterApiKey: "migrate-me" }, null, 2))

	// Ephemeral, unlocked test keychain to avoid GUI prompts
	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		// Ensure no preexisting key in test keychain
		const service = "Cline: openRouterApiKey"
		const account = "cline_openRouterApiKey"
		spawnSync("security", ["delete-generic-password", "-s", service, "-a", account, "-k", keychainPath], { stdio: "ignore" })

		// Run the migration script (compiled from standalone build)
		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }

		// Verify migration script exists
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		const migrator: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })
		let output = ""
		migrator.stdout?.on("data", (d) => {
			output += String(d)
		})
		migrator.stderr?.on("data", (d) => {
			output += String(d)
		})

		// Wait for migration to complete by polling for file removal (source of truth)
		const end = Date.now() + 60000
		let successSeen = false
		let abortSeen = false
		while (Date.now() < end) {
			// If we saw an abort, surface immediately
			abortSeen = /Secrets migration aborted and rolled back|Migration from secrets\.json failed/i.test(output)
			if (abortSeen) {
				break
			}
			if (!fs.existsSync(secretsPath)) {
				successSeen = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator.kill("SIGINT")
		} catch {
			// Ignore if already exited
		}

		if (abortSeen || !successSeen) {
			console.log("Migration output:", output)
		}
		expect(abortSeen).toBeFalsy()
		expect(successSeen).toBeTruthy()
		// File should be removed
		expect(fs.existsSync(secretsPath)).toBeFalsy()

		// Quick keychain presence check (5s max)
		let present = false
		const checkStart = Date.now()
		while (Date.now() - checkStart < 5000) {
			// Keychain path must be positional argument at the end, not with -k flag
			const status = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w", keychainPath], {
				stdio: "ignore",
			}).status
			if (status === 0) {
				present = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}
		expect(present).toBeTruthy()
	} finally {
		cleanup()
	}
})

test("Migration handles empty secrets.json gracefully (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-empty-secrets-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	const secretsPath = path.join(dataDir, "secrets.json")
	fs.writeFileSync(secretsPath, JSON.stringify({}, null, 2))

	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		const migrator: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })
		let output = ""
		migrator.stdout?.on("data", (d) => {
			output += String(d)
		})
		migrator.stderr?.on("data", (d) => {
			output += String(d)
		})

		const end = Date.now() + 30000
		let completed = false
		while (Date.now() < end) {
			if (/MIGRATION_DONE/i.test(output)) {
				completed = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator.kill("SIGINT")
		} catch {}

		expect(completed).toBeTruthy()
		// Empty secrets should not cause errors
		expect(/MIGRATION_FAILED|error/i.test(output)).toBeFalsy()
	} finally {
		cleanup()
	}
})

test("Migration handles multiple secrets correctly (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-multi-secrets-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	const secretsPath = path.join(dataDir, "secrets.json")
	const testSecrets = {
		openRouterApiKey: "test-openrouter-key-123",
		anthropicApiKey: "test-anthropic-key-456",
		openAiApiKey: "test-openai-key-789",
	}
	fs.writeFileSync(secretsPath, JSON.stringify(testSecrets, null, 2))

	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		// Clean up any pre-existing test keys
		for (const key of Object.keys(testSecrets)) {
			const service = `Cline: ${key}`
			const account = `cline_${key}`
			spawnSync("security", ["delete-generic-password", "-s", service, "-a", account, "-k", keychainPath], {
				stdio: "ignore",
			})
		}

		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		const migrator: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })

		const end = Date.now() + 60000
		let successSeen = false
		while (Date.now() < end) {
			if (!fs.existsSync(secretsPath)) {
				successSeen = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator.kill("SIGINT")
		} catch {}

		expect(successSeen).toBeTruthy()
		expect(fs.existsSync(secretsPath)).toBeFalsy()

		// Verify all three secrets are in keychain
		for (const [key, expectedValue] of Object.entries(testSecrets)) {
			const service = `Cline: ${key}`
			const account = `cline_${key}`
			const result = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w", keychainPath], {
				encoding: "utf8",
			})
			expect(result.status).toBe(0)
			expect(result.stdout.trim()).toBe(expectedValue)
		}
	} finally {
		cleanup()
	}
})

test("Migration preserves special characters in secret values (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-special-chars-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	const secretsPath = path.join(dataDir, "secrets.json")
	// Test with base64-like characters and special symbols
	const specialValue = "sk-test_ABC123+/=xyz!@#$%"
	fs.writeFileSync(secretsPath, JSON.stringify({ openRouterApiKey: specialValue }, null, 2))

	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		const service = "Cline: openRouterApiKey"
		const account = "cline_openRouterApiKey"
		spawnSync("security", ["delete-generic-password", "-s", service, "-a", account, "-k", keychainPath], { stdio: "ignore" })

		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		const migrator: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })

		const end = Date.now() + 60000
		let successSeen = false
		while (Date.now() < end) {
			if (!fs.existsSync(secretsPath)) {
				successSeen = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator.kill("SIGINT")
		} catch {}

		expect(successSeen).toBeTruthy()

		// Verify exact value preservation
		const result = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w", keychainPath], {
			encoding: "utf8",
		})
		expect(result.status).toBe(0)
		expect(result.stdout.trim()).toBe(specialValue)
	} finally {
		cleanup()
	}
})

test("Migration is idempotent - running twice is safe (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-idempotent-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	const secretsPath = path.join(dataDir, "secrets.json")
	const testValue = "idempotent-test-key"
	fs.writeFileSync(secretsPath, JSON.stringify({ openRouterApiKey: testValue }, null, 2))

	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		const service = "Cline: openRouterApiKey"
		const account = "cline_openRouterApiKey"
		spawnSync("security", ["delete-generic-password", "-s", service, "-a", account, "-k", keychainPath], { stdio: "ignore" })

		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		// First migration
		const migrator1: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })

		const end1 = Date.now() + 60000
		let success1 = false
		while (Date.now() < end1) {
			if (!fs.existsSync(secretsPath)) {
				success1 = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator1.kill("SIGINT")
		} catch {}

		expect(success1).toBeTruthy()

		// Recreate secrets.json to simulate a second migration attempt
		fs.writeFileSync(secretsPath, JSON.stringify({ openRouterApiKey: "different-value" }, null, 2))

		// Second migration - should handle pre-existing keychain entry
		const migrator2: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })
		let output2 = ""
		migrator2.stdout?.on("data", (d) => {
			output2 += String(d)
		})
		migrator2.stderr?.on("data", (d) => {
			output2 += String(d)
		})

		const end2 = Date.now() + 60000
		let success2 = false
		while (Date.now() < end2) {
			if (!fs.existsSync(secretsPath)) {
				success2 = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator2.kill("SIGINT")
		} catch {}

		expect(success2).toBeTruthy()
		// No errors should occur
		expect(/MIGRATION_FAILED|error/i.test(output2)).toBeFalsy()

		// Verify keychain still has a value (either original or updated)
		const result = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w", keychainPath], {
			encoding: "utf8",
		})
		expect(result.status).toBe(0)
		expect(result.stdout.trim().length).toBeGreaterThan(0)
	} finally {
		cleanup()
	}
})

test("Migration skips when secrets.json doesn't exist (macOS only)", async () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		test.skip(true, "Only macOS migration is supported at this time")
		return
	}
	if (!hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-no-secrets-"))
	const dataDir = path.join(userDataDir, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	// Don't create secrets.json

	const { keychainPath, cleanup } = setupTestKeychain()
	try {
		const procEnv = { ...process.env, CLINE_DIR: userDataDir, CLINE_KEYCHAIN: keychainPath }
		const migrationScript = path.join(process.cwd(), "dist-standalone", "migrate-secrets.js")
		if (!fs.existsSync(migrationScript)) {
			throw new Error("Migration script not found. Run: npm run compile-standalone")
		}

		const migrator: ChildProcess = spawn("node", [migrationScript], { stdio: "pipe", env: procEnv })
		let output = ""
		migrator.stdout?.on("data", (d) => {
			output += String(d)
		})
		migrator.stderr?.on("data", (d) => {
			output += String(d)
		})

		const end = Date.now() + 30000
		let completed = false
		while (Date.now() < end) {
			if (/MIGRATION_DONE/i.test(output)) {
				completed = true
				break
			}
			await new Promise((r) => setTimeout(r, 250))
		}

		try {
			migrator.kill("SIGINT")
		} catch {}

		expect(completed).toBeTruthy()
		// Should not error when file doesn't exist
		expect(/MIGRATION_FAILED|error/i.test(output)).toBeFalsy()
	} finally {
		cleanup()
	}
})
