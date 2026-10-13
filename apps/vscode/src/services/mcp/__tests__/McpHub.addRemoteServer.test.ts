import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as actualDiskModule from "@core/storage/disk"
import fs from "fs/promises"
import os from "os"
import path from "path"

let settingsPath = ""
const diskMock = () => ({ ...actualDiskModule, getMcpSettingsFilePath: async () => settingsPath })
mock.module("@core/storage/disk", diskMock)
mock.module("@/core/storage/disk", diskMock)

import { Logger } from "@/shared/services/Logger"
import { McpHub } from "../McpHub"

// Tests bypass the constructor's watcher via Object.create(McpHub.prototype),
// matching McpHub.callTool.test.ts.
describe("McpHub.addRemoteServer", () => {
	const envVar = "CLINE_TEST_MCP_URL_SECRET"
	const originalIsDev = process.env.IS_DEV
	let tempDir: string
	let hub: McpHub
	let logLines: string[]

	const collect = (msg: string) => {
		logLines.push(msg)
	}

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `mcp-add-remote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
		settingsPath = path.join(tempDir, "cline_mcp_settings.json")
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: {} }))
		hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).getSettingsDirectoryPath = async () => tempDir
		process.env[envVar] = "sk-SECRET"
		// Production builds have IS_DEV unset, which is the Logger path under test.
		delete process.env.IS_DEV
		logLines = []
		Logger.subscribe(collect)
	})

	afterEach(async () => {
		Logger.unsubscribe(collect)
		if (originalIsDev === undefined) {
			delete process.env.IS_DEV
		} else {
			process.env.IS_DEV = originalIsDev
		}
		delete process.env[envVar]
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	async function addInvalid(url: string): Promise<Error> {
		const error = await hub.addRemoteServer("srv", url).catch((e) => e)
		expect(error).toBeInstanceOf(Error)
		expect(error.message).toContain("Invalid server URL")
		// The failure reaches the production log with its message, not just the prefix.
		expect(logLines.join("\n")).toContain("Failed to add remote MCP server: Error: Invalid server URL")
		return error
	}

	it("keeps credentials typed into the URL out of the error and the production log", async () => {
		const error = await addInvalid("https://user:sk-FAKE-SECRET@mcp.example.com:bad/sse?key=FAKE-KEY")
		for (const secret of ["sk-FAKE-SECRET", "FAKE-KEY", "user:"]) {
			expect(error.message).not.toContain(secret)
			expect(logLines.join("\n")).not.toContain(secret)
		}
	})

	it("keeps expanded environment variables out of the error and the production log", async () => {
		const error = await addInvalid(`https://mcp.example.com:\${env:${envVar}}/sse`)
		expect(error.message).not.toContain("sk-SECRET")
		expect(logLines.join("\n")).not.toContain("sk-SECRET")
	})
})
