import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { addMcpServerShortcut } from "./mcp"

const tempDirs: string[] = []

async function createTempConfigDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-mcp-test-"))
	tempDirs.push(dir)
	return dir
}

type McpSettingsFile = {
	mcpServers: Record<string, Record<string, unknown>>
}

async function readMcpSettings(configDir: string): Promise<McpSettingsFile> {
	const settingsPath = path.join(configDir, "data", "settings", "cline_mcp_settings.json")
	return JSON.parse(await fs.readFile(settingsPath, "utf-8")) as McpSettingsFile
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

describe("addMcpServerShortcut", () => {
	it("writes stdio servers with type=stdio", async () => {
		const configDir = await createTempConfigDir()

		await addMcpServerShortcut("kanban", ["kanban", "mcp"], { config: configDir })
		const settings = await readMcpSettings(configDir)

		expect(settings.mcpServers.kanban).toEqual({
			command: "kanban",
			args: ["mcp"],
			type: "stdio",
		})
	})

	it("maps --type http to streamableHttp", async () => {
		const configDir = await createTempConfigDir()

		await addMcpServerShortcut("linear", ["https://mcp.linear.app/mcp"], { config: configDir, type: "http" })
		const settings = await readMcpSettings(configDir)

		expect(settings.mcpServers.linear).toEqual({
			url: "https://mcp.linear.app/mcp",
			type: "streamableHttp",
		})
	})

	it("errors when URL is provided without --type http", async () => {
		const configDir = await createTempConfigDir()

		await expect(addMcpServerShortcut("linear", ["https://mcp.linear.app/mcp"], { config: configDir })).rejects.toThrow(
			"Use --type http",
		)
	})
})
