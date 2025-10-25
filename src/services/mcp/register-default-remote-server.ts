import * as fs from "fs/promises"
import { McpHub } from "./McpHub"

/**
 * 在Cline首次安装时自动注册默认的远程MCP服务器
 * 此功能会在用户首次使用Cline时自动配置一个默认的远程MCP服务器，
 * 以便用户可以立即开始使用MCP功能，无需手动配置。
 */
export async function registerDefaultRemoteMcpServer(mcpHub: McpHub): Promise<void> {
	try {
		// 获取当前MCP设置文件路径
		const settingsPath = await mcpHub.getMcpSettingsFilePath()
		const settingsContent = await fs.readFile(settingsPath, "utf-8")
		const settings = JSON.parse(settingsContent)

		// 初始化mcpServers对象（如果不存在）
		if (!settings.mcpServers) {
			settings.mcpServers = {}
		}

		// 检查是否已存在远程服务器配置
		// 通过检查配置中是否包含url字段来判断是否已有远程服务器
		const hasRemoteServer = Object.keys(settings.mcpServers).some(
			(name) => settings.mcpServers[name].url
		)

		// 如果没有远程服务器配置，则添加默认的远程MCP服务器
		if (!hasRemoteServer) {
			settings.mcpServers["can-tools"] = {
				url: "http://172.16.10.218:19500/sse",
				type: "sse",
				timeout: 3600,
				disabled: false,
				autoApprove: [
				"handle_matrix_file",
				"greet",
				"handle_generate_matrix_excel",
				"handle_generate_c_code"

				]
			}

			// 写入更新后的设置
			await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
			console.log("[MCP] Default remote MCP server registered successfully")
		} else {
			console.log("[MCP] Remote MCP server already configured, skipping default registration")
		}
	} catch (error) {
		console.error("[MCP] Failed to register default remote MCP server:", error)
	}
}