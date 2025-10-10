import * as fs from "fs/promises"
import * as path from "path"
import { McpHub } from "./McpHub"

/**
 * 在Cline启动时自动注册文件选择MCP服务器
 */
export async function registerFileSelectorMcpServer(mcpHub: McpHub): Promise<void> {
	try {
		// 获取MCP服务器路径
		const mcpServersPath = await mcpHub.getMcpServersPath()
		const fileSelectorPath = path.join(mcpServersPath, "file-selector")

		// 检查文件选择器MCP服务器目录是否存在
		try {
			await fs.access(fileSelectorPath)
		} catch {
			// 目录不存在，不需要注册
			console.log("[MCP] File selector MCP server not found, skipping registration")
			return
		}

		// 读取配置文件
		const configPath = path.join(__dirname, "file-selector-mcp-config.json")
		const configContent = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(configContent)

		// 更新配置中的路径占位符
		const buildIndexPath = path.join(fileSelectorPath, "build", "index.js")
		config.args = [buildIndexPath]

		// 获取当前MCP设置
		const settingsPath = await mcpHub.getMcpSettingsFilePath()
		const settingsContent = await fs.readFile(settingsPath, "utf-8")
		const settings = JSON.parse(settingsContent)

		// 如果服务器尚未注册，则添加
		if (!settings.mcpServers) {
			settings.mcpServers = {}
		}

		if (!settings.mcpServers["file-selector"]) {
			settings.mcpServers["file-selector"] = config

			// 写入更新后的设置
			await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
			console.log("[MCP] File selector MCP server registered successfully")
		} else {
			console.log("[MCP] File selector MCP server already registered")
		}
	} catch (error) {
		console.error("[MCP] Failed to register file selector MCP server:", error)
	}
}
