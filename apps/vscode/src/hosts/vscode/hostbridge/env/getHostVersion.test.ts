import { strict as assert } from "assert"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient } from "@/shared/cline"
import { getHostVersion } from "./getHostVersion"

describe("Hostbridge - Env - getHostVersion", () => {
	const sandbox = sinon.createSandbox()

	afterEach(() => {
		sandbox.restore()
	})

	it("preserves known remote workspace names", async () => {
		const cases = ["ssh-remote", "dev-container", "codespaces"]

		for (const remoteName of cases) {
			const remoteNameStub = sandbox.stub(vscode.env, "remoteName")
			remoteNameStub.get(() => remoteName)

			const response = await getHostVersion({} as any)

			assert.strictEqual(response.platform, vscode.env.appName)
			assert.strictEqual(response.version, vscode.version)
			assert.strictEqual(response.clineType, ClineClient.VSCode)
			assert.strictEqual(response.clineVersion, ExtensionRegistryInfo.version)
			assert.strictEqual(response.remoteName, remoteName)

			remoteNameStub.restore()
		}
	})

	it("normalizes empty remote workspace names to undefined", async () => {
		sandbox.stub(vscode.env, "remoteName").get(() => "")

		const response = await getHostVersion({} as any)

		assert.strictEqual(response.remoteName, undefined)
	})

	it("keeps local workspaces without a remoteName", async () => {
		sandbox.stub(vscode.env, "remoteName").get(() => undefined)

		const response = await getHostVersion({} as any)

		assert.strictEqual(response.remoteName, undefined)
	})
})
