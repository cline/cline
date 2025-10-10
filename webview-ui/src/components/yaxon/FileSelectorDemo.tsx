import { FileOutlined, FolderOpenOutlined } from "@ant-design/icons"
import { StringRequest } from "@shared/proto/cline/common"
import { Button, Card, message, Space, Typography } from "antd"
import { useState } from "react"
import styled from "styled-components"
import { McpServiceClient } from "@/services/grpc-client"

const { Title, Text } = Typography

const DemoCard = styled(Card)`
  background-color: var(--vscode-sideBar-background);
  border-color: var(--vscode-panel-border);
  margin-bottom: 20px;
  
  .ant-card-body {
    background-color: var(--vscode-sideBar-background);
    padding: 24px;
  }
`

const FileSelectorDemo = () => {
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
	const [isSelecting, setIsSelecting] = useState(false)

	const handleSelectFile = async () => {
		setIsSelecting(true)
		try {
			// 调用MCP服务来选择文件
			// 注意：在实际实现中，这需要与MCP服务器进行交互
			message.info("在实际实现中，这将打开VS Code文件选择对话框")

			// 模拟文件选择结果
			setTimeout(() => {
				setSelectedFilePath("/path/to/selected/file.txt")
				setIsSelecting(false)
				message.success("文件选择成功")
			}, 1000)
		} catch (error) {
			console.error("Failed to select file:", error)
			message.error("文件选择失败")
			setIsSelecting(false)
		}
	}

	const handleUseMcpTool = async () => {
		try {
			// 这里演示如何调用MCP工具
			message.info("这将调用MCP服务器的select_file工具")

			// 实际的MCP调用代码示例（注释掉因为需要实际的MCP服务器运行）：
			/*
      const result = await McpServiceClient.callTool({
        serverName: "file-selector",
        toolName: "select_file",
        arguments: {
          title: "选择一个文件",
          canSelectFiles: true,
          canSelectFolders: false
        }
      })
      console.log("MCP tool result:", result)
      */
		} catch (error) {
			console.error("Failed to call MCP tool:", error)
			message.error("调用MCP工具失败")
		}
	}

	return (
		<DemoCard>
			<Space direction="vertical" size="large" style={{ width: "100%" }}>
				<div>
					<Title
						level={4}
						style={{
							color: "var(--vscode-foreground)",
							marginTop: 0,
							marginBottom: "16px",
						}}>
						<FolderOpenOutlined /> 文件选择MCP服务器演示
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
						演示如何通过MCP服务器调用VS Code功能选择文件
					</Text>
				</div>

				<div>
					<Button
						icon={<FolderOpenOutlined />}
						loading={isSelecting}
						onClick={handleSelectFile}
						size="large"
						style={{ width: "100%" }}
						type="primary">
						选择文件 (模拟)
					</Button>
				</div>

				<div>
					<Button
						icon={<FileOutlined />}
						onClick={handleUseMcpTool}
						size="large"
						style={{ width: "100%" }}
						type="default">
						调用MCP工具 (示例)
					</Button>
				</div>

				{selectedFilePath && (
					<div
						style={{
							padding: "12px",
							backgroundColor: "var(--vscode-editor-background)",
							borderRadius: "4px",
							border: "1px solid var(--vscode-panel-border)",
						}}>
						<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
							已选择文件:
						</Text>
						<Text style={{ color: "var(--vscode-foreground)", fontFamily: "monospace" }}>{selectedFilePath}</Text>
					</div>
				)}

				<div
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						padding: "16px",
						borderRadius: "4px",
						border: "1px solid var(--vscode-panel-border)",
					}}>
					<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
						使用说明：
					</Text>
					<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
						<li>点击"选择文件"按钮模拟文件选择过程</li>
						<li>点击"调用MCP工具"按钮查看如何调用MCP服务器工具</li>
						<li>实际部署时，MCP服务器将提供真实的VS Code文件选择功能</li>
						<li>服务器会在Cline启动时自动启用</li>
					</ul>
				</div>
			</Space>
		</DemoCard>
	)
}

export default FileSelectorDemo
