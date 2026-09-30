import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as actualDiskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"

let settingsPath = ""
const diskMock = () => ({ ...actualDiskModule, getMcpSettingsFilePath: async () => settingsPath })
mock.module("@core/storage/disk", diskMock)
mock.module("@/core/storage/disk", diskMock)

import { McpHub } from "../McpHub"

// Tests bypass the constructor's watcher via Object.create(McpHub.prototype),
// matching McpHub.callTool.test.ts.
describe("McpHub.addRemoteServer", () => {
	const envVar = "CLINE_TEST_MCP_URL_SECRET"
	let tempDir: string
	let hub: McpHub

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `mcp-add-remote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: {} }))
		hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).getSettingsDirectoryPath = async () => tempDir
		process.env[envVar] = "sk-SECRET"
	})

	afterEach(async () => {
		delete process.env[envVar]
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("does not put expanded environment variables in the invalid-URL error", async () => {
		const error = await hub.addRemoteServer("srv", `https://mcp.example.com:\${env:${envVar}}/sse`).catch((e) => e)
		expect(error).toBeInstanceOf(Error)
		expect(error.message).toContain("Invalid server URL")
		expect(error.message).not.toContain("sk-SECRET")
		expect(error.message).toContain(`\${env:${envVar}}`)
	})
})
