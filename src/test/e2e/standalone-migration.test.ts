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

test("Standalone migration moves secrets.json to OS keychain and removes file", async () => {
	const platform = os.platform()
	if (platform === "win32") {
		test.skip(true, "Skip on Windows; covered by shell/E2E elsewhere")
		return
	}
	if (platform === "darwin" && !hasCommand("security")) {
		test.skip(true, "security CLI not available on macOS runner")
		return
	}
	if (platform === "linux" && !hasCommand("secret-tool")) {
		test.skip(true, "secret-tool not available on Linux runner")
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
	if (platform === "darwin") {
		spawnSync("security", ["delete-generic-password", "-s", service, "-a", account], { stdio: "ignore" })
	} else if (platform === "linux") {
		spawnSync("secret-tool", ["clear", "service", service, "account", account], { stdio: "ignore" })
	}

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

	// Wait until server prints that it's running, then poll for migration results
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => resolve(), 3000)
		server.stdout?.once("data", () => {
			clearTimeout(timeout)
			resolve()
		})
		server.once("error", reject)
	})

	// Poll keychain up to ~10s for migration to complete
	const start = Date.now()
	let present = false
	while (Date.now() - start < 10000) {
		const status =
			platform === "darwin"
				? spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
						stdio: "ignore",
					}).status
				: spawnSync("secret-tool", ["lookup", "service", service, "account", account], { stdio: "ignore" }).status
		if (status === 0) {
			present = true
			break
		}
		await new Promise((r) => setTimeout(r, 300))
	}

	// Stop server
	try {
		server.kill("SIGINT")
	} catch {}

	expect(present).toBeTruthy()
	expect(fs.existsSync(secretsPath)).toBeFalsy()
})
