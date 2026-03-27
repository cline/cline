import { strict as assert } from "assert"
import { afterEach, describe, it } from "mocha"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient } from "@/shared/cline"
import { getHostVersion } from "./getHostVersion"

describe("Hostbridge - Env - getHostVersion", () => {
	const originalEnv = {
		appName: vscode.env.appName,
		version: vscode.version,
		remoteName: vscode.env.remoteName,
	}

	afterEach(() => {
		const mutableEnv = vscode.env as any
		mutableEnv.appName = originalEnv.appName
		mutableEnv.remoteName = originalEnv.remoteName
		;(vscode as any).version = originalEnv.version
	})

	it("preserves known remote workspace names", async () => {
		const cases = ["ssh-remote", "dev-container", "codespaces"]

		for (const remoteName of cases) {
			const mutableEnv = vscode.env as any
			mutableEnv.appName = "VS Code"
			mutableEnv.remoteName = remoteName
			;(vscode as any).version = "1.103.0"

			const response = await getHostVersion({} as any)

			assert.strictEqual(response.platform, "VS Code")
			assert.strictEqual(response.version, "1.103.0")
			assert.strictEqual(response.clineType, ClineClient.VSCode)
			assert.strictEqual(response.clineVersion, ExtensionRegistryInfo.version)
			assert.strictEqual(response.remoteName, remoteName)
		}
	})

	it("normalizes empty remote workspace names to undefined", async () => {
		const mutableEnv = vscode.env as any
		mutableEnv.remoteName = ""

		const response = await getHostVersion({} as any)

		assert.strictEqual(response.remoteName, undefined)
	})

	it("keeps local workspaces without a remoteName", async () => {
		const mutableEnv = vscode.env as any
		mutableEnv.remoteName = undefined

		const response = await getHostVersion({} as any)

		assert.strictEqual(response.remoteName, undefined)
	})
})
