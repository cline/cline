import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ClineDefaultTool } from "@shared/tools"
import { AgentConfigLoader } from "./AgentConfigLoader"

describe("AgentConfigLoader retired tools", () => {
	let homeDir: string
	let configPath: string

	beforeEach(async () => {
		await AgentConfigLoader.resetInstanceForTests()
		homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-agent-config-"))
		const agentsDir = path.join(homeDir, "Documents", "Cline", "Agents")
		await fs.mkdir(agentsDir, { recursive: true })
		configPath = path.join(agentsDir, "reviewer.yaml")
	})

	afterEach(async () => {
		await AgentConfigLoader.resetInstanceForTests()
		await fs.rm(homeDir, { recursive: true, force: true })
	})

	async function loadConfig(tools: string) {
		const content = `---
name: Reviewer
description: Reviews changes
modelId: example-model
skills: review
tools: ${tools}
---
Review the code carefully.
`
		await fs.writeFile(configPath, content)
		const loader = AgentConfigLoader.getInstance(homeDir)
		await loader.ready()
		return { loader, content }
	}

	it.each([
		"read_file, focus_chain, list_files, read_file, focus_chain",
		'["read_file", " focus_chain ", "list_files", "read_file", "focus_chain"]',
	])("ignores the retired tool in saved configs: %s", async (tools) => {
		const { loader, content } = await loadConfig(tools)

		expect(loader.getCachedConfig("reviewer")).toEqual({
			name: "Reviewer",
			description: "Reviews changes",
			modelId: "example-model",
			skills: ["review"],
			tools: [ClineDefaultTool.FILE_READ, ClineDefaultTool.LIST_FILES],
			systemPrompt: "Review the code carefully.",
		})
		expect(loader.getAllCachedConfigsWithToolNames()).toHaveLength(1)
		expect(await fs.readFile(configPath, "utf8")).toBe(content)
		expect(Object.values(ClineDefaultTool)).not.toContain("focus_chain")
	})

	it.each([
		"focus_chain",
		'[" focus_chain ", "focus_chain"]',
	])("keeps an agent whose only saved tool was retired: %s", async (tools) => {
		const { loader } = await loadConfig(tools)
		expect(loader.getCachedConfig("reviewer")?.tools).toEqual([])
	})

	it("preserves active tools and deduplication", async () => {
		const { loader } = await loadConfig("read_file, list_files, read_file")
		expect(loader.getCachedConfig("reviewer")?.tools).toEqual([ClineDefaultTool.FILE_READ, ClineDefaultTool.LIST_FILES])
	})

	it.each([
		"read_file, focus_chain, not_a_tool",
		"read_file, focus_chain,",
		'["focus_chain", ""]',
	])("still rejects unknown or empty tool names: %s", async (tools) => {
		const { loader } = await loadConfig(tools)
		expect(loader.getAllCachedConfigs().size).toBe(0)
	})
})
