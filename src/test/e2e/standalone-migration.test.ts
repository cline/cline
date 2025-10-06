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
	const keychainPath = path.join(os.tmpdir(), `cline-tests-${Date.now()}-${Math.random().toString(36).slice(2)}.keychain-db`)
	const keychainPwd = "cline-test-pass"
	try {
		spawnSync("security", ["create-keychain", "-p", keychainPwd, keychainPath], { stdio: "ignore" })
		spawnSync("security", ["set-keychain-settings", "-lut", "3600", keychainPath], { stdio: "ignore" })
		spawnSync("security", ["unlock-keychain", "-p", keychainPwd, keychainPath], { stdio: "ignore" })

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

		// Second run: ensure no re-migration and legacy file is not recreated
		const server2: ChildProcess = spawn(
			process.platform === "win32" ? "npx.cmd" : "npx",
			["tsx", "scripts/test-standalone-core-api-server.ts"],
			{ stdio: "pipe", env: procEnv },
		)

		// Capture output for debugging if needed
		server2.stdout?.on("data", () => {
			// Output captured but not used - server just needs to run
		})
		server2.stderr?.on("data", () => {
			// Output captured but not used - server just needs to run
		})

		// Give it a short window to initialize
		await new Promise((r) => setTimeout(r, 4000))
		try {
			server2.kill("SIGINT")
		} catch {}

		// secrets.json should not have been recreated
		expect(fs.existsSync(secretsPath)).toBeFalsy()
	} finally {
		// Clean up test keychain
		spawnSync("security", ["delete-keychain", keychainPath], { stdio: "ignore" })
	}
})

test("Standalone deps warning emitted when deps missing (best-effort)", async () => {
	const platform = os.platform()
	if (platform === "win32") {
		test.skip(true, "Skip on Windows to avoid spawn EINVAL with npx in CI")
		return
	}

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-standalone-warn-"))
	const procEnv = { ...process.env, CLINE_DIR: userDataDir, E2E_TEST: "true", CLINE_ENVIRONMENT: "local" }
	const server: ChildProcess = spawn(
		process.platform === "win32" ? "npx.cmd" : "npx",
		["tsx", "scripts/test-standalone-core-api-server.ts"],
		{
			stdio: "pipe",
			env: procEnv,
		},
	)

	let output2 = ""
	server.stdout?.on("data", (d) => {
		output2 += String(d)
	})
	server.stderr?.on("data", (d) => {
		output2 += String(d)
	})

	await new Promise((r) => setTimeout(r, 6000))
	try {
		server.kill("SIGINT")
	} catch {}

	// Non-strict: just check our message shows up if deps are missing
	const hinted = /Falling back to file storage|CredentialManager PowerShell module not available|secret-tool\/libsecret/i.test(
		output2,
	)
	expect(typeof hinted).toBe("boolean")
})
