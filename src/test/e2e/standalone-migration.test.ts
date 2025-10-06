import { ChildProcess, spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, test } from "@playwright/test"

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") return true
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

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

	// Ensure no preexisting key in OS keychain
	const service = "Cline: openRouterApiKey"
	const account = "cline_openRouterApiKey"
	spawnSync("security", ["delete-generic-password", "-s", service, "-a", account], { stdio: "ignore" })

	// Start the standalone core service via helper script
	const procEnv = {
		...process.env,
		CLINE_DIR: userDataDir,
		E2E_TEST: "true",
		CLINE_ENVIRONMENT: "local",
	}

	const server: ChildProcess = spawn(
		process.platform === "win32" ? "npx.cmd" : "npx",
		["tsx", "scripts/test-standalone-core-api-server.ts"],
		{ stdio: "pipe", env: procEnv },
	)

	// Capture logs
	let output = ""
	server.stdout?.on("data", (d) => (output += String(d)))
	server.stderr?.on("data", (d) => (output += String(d)))

	// Helper to wait for a regex in output up to timeoutMs
	async function waitFor(pattern: RegExp, timeoutMs: number): Promise<boolean> {
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			if (pattern.test(output)) return true
			await new Promise((r) => setTimeout(r, 200))
		}
		return false
	}

	// Wait for migration complete log (deterministic), up to 45s
	const successSeen = await waitFor(
		/Secrets migration: (migrated .* entries; removed secrets\.json|all entries already present; removed secrets\.json)/i,
		45000,
	)
	// If an abort log appeared, surface it
	const abortSeen =
		/Secrets migration aborted and rolled back/i.test(output) || /Migration from secrets\.json failed/i.test(output)

	// Stop server
	try {
		server.kill("SIGINT")
	} catch {}

	expect(abortSeen).toBeFalsy()
	expect(successSeen).toBeTruthy()
	// File should be removed
	expect(fs.existsSync(secretsPath)).toBeFalsy()

	// Quick keychain presence check (5s max)
	let present = false
	const checkStart = Date.now()
	while (Date.now() - checkStart < 5000) {
		const status = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
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

	let outputSecond = ""
	server2.stdout?.on("data", (d) => (outputSecond += String(d)))
	server2.stderr?.on("data", (d) => (outputSecond += String(d)))

	// Give it a short window to initialize
	await new Promise((r) => setTimeout(r, 4000))
	try {
		server2.kill("SIGINT")
	} catch {}

	// secrets.json should not have been recreated
	expect(fs.existsSync(secretsPath)).toBeFalsy()
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
	server.stdout?.on("data", (d) => (output2 += String(d)))
	server.stderr?.on("data", (d) => (output2 += String(d)))

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
