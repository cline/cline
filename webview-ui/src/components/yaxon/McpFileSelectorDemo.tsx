import { FileTextOutlined, FolderOpenOutlined } from "@ant-design/icons"
import { Button, Card, message, Space, Typography } from "antd"
import React, { useState } from "react"
import styled from "styled-components"

const { Title, Text } = Typography

const DemoContainer = styled.div`
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
`

const DemoCard = styled(Card)`
  background-color: var(--vscode-sideBar-background);
  border-color: var(--vscode-panel-border);
  margin-bottom: 20px;
  flex: 1;
  
  .ant-card-body {
    background-color: var(--vscode-sideBar-background);
    padding: 24px;
    height: 100%;
  }
`

const McpFileSelectorDemo: React.FC = () => {
	const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
	const [isSelecting, setIsSelecting] = useState(false)

	// 模拟调用MCP服务器选择文件
	const handleSelectFile = async () => {
		setIsSelecting(true)
		try {
			// 这里应该调用实际的MCP服务器
			// 由于MCP服务器需要在Cline启动时配置，这里只是演示UI
			message.info("在实际部署中，这将调用MCP服务器的select_file工具")

			// 模拟延迟
			setTimeout(() => {
				setSelectedFilePath("/workspace/src/example/file.txt")
				setIsSelecting(false)
				message.success("文件选择成功")
			}, 1500)
		} catch (error) {
			console.error("Failed to select file:", error)
			message.error("文件选择失败")
			setIsSelecting(false)
		}
	}

	return (
		<DemoContainer>
			<Space direction="vertical" size="large" style={{ width: "100%" }}>
				<div>
					<Title
						level={3}
						style={{
							color: "var(--vscode-foreground)",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							marginBottom: "8px",
						}}>
						<FolderOpenOutlined />
						MCP文件选择器演示
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
						演示如何通过MCP服务器调用VS Code功能选择文件
					</Text>
				</div>

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
								文件选择功能
							</Title>
							<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
								点击下面的按钮来演示调用MCP服务器选择文件的功能
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
								选择文件 (MCP调用演示)
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
									<FileTextOutlined /> 已选择文件:
								</Text>
								<Text style={{ color: "var(--vscode-foreground)", fontFamily: "monospace" }}>
									{selectedFilePath}
								</Text>
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
								<li>此演示展示了如何通过MCP服务器调用VS Code的文件选择功能</li>
								<li>实际部署时，MCP服务器会在Cline启动时自动启用</li>
								<li>点击按钮会调用MCP服务器的select_file工具</li>
								<li>工具会打开VS Code的文件选择对话框并返回选中的文件路径</li>
							</ul>
						</div>

						<div
							style={{
								backgroundColor: "var(--vscode-editor-background)",
								padding: "16px",
								borderRadius: "4px",
								border: "1px solid var(--vscode-panel-border)",
							}}>
							<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
								技术实现：
							</Text>
							<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
								<li>MCP服务器位于: src/services/mcp/servers/file-selector</li>
								<li>使用@modelcontextprotocol/sdk构建</li>
								<li>通过stdio与Cline主进程通信</li>
								<li>在Cline启动时自动注册并启用</li>
							</ul>
						</div>
					</Space>
				</DemoCard>
			</Space>
		</DemoContainer>
	)
}

export default McpFileSelectorDemo
