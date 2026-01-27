/**
 * MCP Server configuration utilities for CLI
 */

import fs from "node:fs/promises"
import path from "node:path"
import { CLINE_CLI_DIR } from "./path"

const MCP_SETTINGS_FILENAME = "cline_mcp_settings.json"

export interface StdioServerConfig {
	type?: "stdio"
	command: string
	args?: string[]
	cwd?: string
	env?: Record<string, string>
	autoApprove?: string[]
	disabled?: boolean
	timeout?: number
}

export interface SseServerConfig {
	type: "sse"
	url: string
	headers?: Record<string, string>
	autoApprove?: string[]
	disabled?: boolean
	timeout?: number
}

export interface StreamableHttpServerConfig {
	type: "streamableHttp"
	url: string
	headers?: Record<string, string>
	autoApprove?: string[]
	disabled?: boolean
	timeout?: number
}

export type McpServerConfig = StdioServerConfig | SseServerConfig | StreamableHttpServerConfig

export interface McpSettings {
	mcpServers: Record<string, McpServerConfig>
}

/**
 * Get the path to the MCP settings file
 */
export function getMcpSettingsPath(dataDir?: string): string {
	return path.join(dataDir ?? CLINE_CLI_DIR.data, MCP_SETTINGS_FILENAME)
}

/**
 * Read MCP settings from disk
 */
export async function readMcpSettings(dataDir?: string): Promise<McpSettings> {
	const settingsPath = getMcpSettingsPath(dataDir)
	try {
		const content = await fs.readFile(settingsPath, "utf-8")
		return JSON.parse(content)
	} catch (error: any) {
		if (error.code === "ENOENT") {
			return { mcpServers: {} }
		}
		throw error
	}
}

/**
 * Write MCP settings to disk
 */
export async function writeMcpSettings(settings: McpSettings, dataDir?: string): Promise<void> {
	const settingsPath = getMcpSettingsPath(dataDir)
	// Ensure directory exists
	await fs.mkdir(path.dirname(settingsPath), { recursive: true })
	await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
}

/**
 * Add or update an MCP server
 */
export async function addMcpServer(name: string, config: McpServerConfig, dataDir?: string): Promise<void> {
	const settings = await readMcpSettings(dataDir)
	settings.mcpServers[name] = config
	await writeMcpSettings(settings, dataDir)
}

/**
 * Remove an MCP server
 */
export async function removeMcpServer(name: string, dataDir?: string): Promise<boolean> {
	const settings = await readMcpSettings(dataDir)
	if (!(name in settings.mcpServers)) {
		return false
	}
	delete settings.mcpServers[name]
	await writeMcpSettings(settings, dataDir)
	return true
}

/**
 * Enable or disable an MCP server
 */
export async function setMcpServerDisabled(name: string, disabled: boolean, dataDir?: string): Promise<boolean> {
	const settings = await readMcpSettings(dataDir)
	if (!(name in settings.mcpServers)) {
		return false
	}
	settings.mcpServers[name].disabled = disabled
	await writeMcpSettings(settings, dataDir)
	return true
}

/**
 * Get a single MCP server config
 */
export async function getMcpServer(name: string, dataDir?: string): Promise<McpServerConfig | undefined> {
	const settings = await readMcpSettings(dataDir)
	return settings.mcpServers[name]
}

/**
 * List all MCP servers
 */
export async function listMcpServers(dataDir?: string): Promise<Array<{ name: string; config: McpServerConfig }>> {
	const settings = await readMcpSettings(dataDir)
	return Object.entries(settings.mcpServers).map(([name, config]) => ({ name, config }))
}

/**
 * Update auto-approve tools for an MCP server
 */
export async function updateMcpServerAutoApprove(
	name: string,
	action: "add" | "remove" | "set" | "clear",
	tools: string[],
	dataDir?: string,
): Promise<boolean> {
	const settings = await readMcpSettings(dataDir)
	if (!(name in settings.mcpServers)) {
		return false
	}

	const server = settings.mcpServers[name]
	const currentTools = server.autoApprove ?? []

	switch (action) {
		case "add":
			server.autoApprove = [...new Set([...currentTools, ...tools])]
			break
		case "remove":
			server.autoApprove = currentTools.filter((t) => !tools.includes(t))
			break
		case "set":
			server.autoApprove = tools
			break
		case "clear":
			server.autoApprove = []
			break
	}

	await writeMcpSettings(settings, dataDir)
	return true
}

/**
 * Parse key=value pairs from command line arguments
 */
export function parseKeyValuePairs(pairs: string[]): Record<string, string> {
	const result: Record<string, string> = {}
	for (const pair of pairs) {
		const eqIndex = pair.indexOf("=")
		if (eqIndex === -1) {
			throw new Error(`Invalid key=value format: ${pair}`)
		}
		const key = pair.substring(0, eqIndex)
		const value = pair.substring(eqIndex + 1)
		result[key] = value
	}
	return result
}

/**
 * Format server config for display
 */
export function formatServerConfig(name: string, config: McpServerConfig): string {
	const lines: string[] = []
	const status = config.disabled ? " (disabled)" : ""

	if ("command" in config && config.command) {
		// STDIO server
		lines.push(`${name}${status} [stdio]`)
		lines.push(`  command: ${config.command}`)
		if (config.args?.length) {
			lines.push(`  args: ${config.args.join(" ")}`)
		}
		if (config.cwd) {
			lines.push(`  cwd: ${config.cwd}`)
		}
		if (config.env && Object.keys(config.env).length > 0) {
			lines.push(
				`  env: ${Object.entries(config.env)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ")}`,
			)
		}
	} else if ("url" in config && config.url) {
		// SSE or Streamable HTTP server
		const type = config.type === "streamableHttp" ? "http" : "sse"
		lines.push(`${name}${status} [${type}]`)
		lines.push(`  url: ${config.url}`)
		if (config.headers && Object.keys(config.headers).length > 0) {
			const headerKeys = Object.keys(config.headers).join(", ")
			lines.push(`  headers: ${headerKeys}`)
		}
	}

	if (config.timeout) {
		lines.push(`  timeout: ${config.timeout}s`)
	}
	if (config.autoApprove?.length) {
		lines.push(`  auto-approve: ${config.autoApprove.join(", ")}`)
	}

	return lines.join("\n")
}
