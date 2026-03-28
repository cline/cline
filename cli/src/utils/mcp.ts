import * as fs from "node:fs/promises"
import path from "node:path"
import { getMcpSettingsFilePath } from "@/core/storage/disk"
import { ServerConfigSchema } from "@/services/mcp/schemas"
import { initializeCliContext } from "../vscode-context"

export interface McpAddOptions {
	type?: string
	config?: string
	cwd?: string
}

export type McpAddTransportType = "stdio" | "streamableHttp" | "sse"

export interface AddMcpServerResult {
	serverName: string
	transportType: McpAddTransportType
	settingsPath: string
}

function normalizeMcpTransportType(value?: string): McpAddTransportType {
	const normalized = (value || "stdio").trim().toLowerCase()

	switch (normalized) {
		case "stdio":
			return "stdio"
		case "http":
		case "streamable-http":
		case "streamablehttp":
			return "streamableHttp"
		case "sse":
			return "sse"
		default:
			throw new Error(`Invalid MCP transport type '${value}'. Valid values: stdio, http, sse.`)
	}
}

function parseMcpSettings(content: string, settingsPath: string): Record<string, unknown> {
	const trimmedContent = content.trim()
	if (!trimmedContent) {
		return { mcpServers: {} }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		throw new Error(`Invalid JSON in ${settingsPath}. Please fix the file and try again.`)
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid MCP settings file at ${settingsPath}. Expected a JSON object.`)
	}

	const settings = parsed as Record<string, unknown>
	if (settings.mcpServers === undefined) {
		settings.mcpServers = {}
	}

	if (!settings.mcpServers || typeof settings.mcpServers !== "object" || Array.isArray(settings.mcpServers)) {
		throw new Error(`Invalid MCP settings file at ${settingsPath}. Expected 'mcpServers' to be an object.`)
	}

	return settings
}

function createMcpServerConfig(targetOrCommand: string[], transportType: McpAddTransportType): Record<string, unknown> {
	if (transportType === "stdio") {
		if (targetOrCommand.length < 1) {
			throw new Error("Missing stdio command. Example: cline mcp add kanban -- kanban mcp")
		}

		// Guard against common mistake:
		// `cline mcp add <name> <url>` without `--type http`
		if (targetOrCommand.length === 1) {
			const [value] = targetOrCommand
			try {
				const parsedUrl = new URL(value)
				if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
					throw new Error(
						`Looks like you provided a URL for '${value}'. Use --type http, for example: cline mcp add <name> ${value} --type http`,
					)
				}
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("Looks like you provided a URL")) {
					throw error
				}
			}
		}

		const [command, ...args] = targetOrCommand
		const config: Record<string, unknown> = {
			command,
			type: "stdio",
		}

		if (args.length > 0) {
			config.args = args
		}

		ServerConfigSchema.parse(config)
		return config
	}

	if (targetOrCommand.length !== 1) {
		throw new Error(
			"HTTP/SSE MCP servers require exactly one URL. Example: cline mcp add linear https://mcp.linear.app/mcp --type http",
		)
	}

	const config = {
		url: targetOrCommand[0],
		type: transportType,
	}

	ServerConfigSchema.parse(config)
	return config
}

export async function addMcpServerShortcut(
	name: string,
	targetOrCommand: string[] = [],
	options: McpAddOptions,
): Promise<AddMcpServerResult> {
	const trimmedName = name.trim()
	if (!trimmedName) {
		throw new Error("Server name is required.")
	}

	const transportType = normalizeMcpTransportType(options.type)

	const { DATA_DIR } = initializeCliContext({
		clineDir: options.config,
		workspaceDir: options.cwd || process.cwd(),
	})

	const settingsDirectoryPath = path.join(DATA_DIR, "settings")
	await fs.mkdir(settingsDirectoryPath, { recursive: true })
	const settingsPath = await getMcpSettingsFilePath(settingsDirectoryPath)

	const content = await fs.readFile(settingsPath, "utf-8")
	const settings = parseMcpSettings(content, settingsPath)
	const mcpServers = settings.mcpServers as Record<string, unknown>

	if (mcpServers[trimmedName]) {
		throw new Error(`An MCP server named '${trimmedName}' already exists.`)
	}

	const serverConfig = createMcpServerConfig(targetOrCommand, transportType)
	mcpServers[trimmedName] = serverConfig

	await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")

	return {
		serverName: trimmedName,
		transportType,
		settingsPath,
	}
}
