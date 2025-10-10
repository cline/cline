import { CheckOutlined, DownloadOutlined, FileDoneOutlined } from "@ant-design/icons"
import { Button, Card, Space, Typography } from "antd"
import React from "react"
import CodeBlock from "@/components/common/CodeBlock"

const { Title, Text } = Typography

interface ConfirmDbcFileProps {
	dbcContent: string
	fileName: string
	onConfirm: () => void
	onDownload: () => void
}

const ConfirmDbcFile: React.FC<ConfirmDbcFileProps> = ({ dbcContent, fileName, onConfirm, onDownload }) => {
	// 创建符合CodeBlock要求的源代码格式
	const dbcSource = `\`\`\`dbc
${dbcContent}
\`\`\``

	return (
		<Card
			bodyStyle={{
				backgroundColor: "var(--vscode-sideBar-background)",
			}}
			style={{
				backgroundColor: "var(--vscode-sideBar-background)",
				borderColor: "var(--vscode-panel-border)",
			}}>
			<Space direction="vertical" size="large" style={{ width: "100%" }}>
				<div>
					<Title
						level={5}
						style={{
							color: "var(--vscode-foreground)",
							margin: 0,
						}}>
						<FileDoneOutlined /> DBC文件已生成：
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
						已成功将矩阵文件转换为标准DBC文件，请确认内容
					</Text>
				</div>

				<div>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "12px",
						}}>
						<Text strong style={{ color: "var(--vscode-foreground)" }}>
							生成的DBC文件内容预览：
						</Text>
						<Button icon={<DownloadOutlined />} onClick={onDownload}>
							下载DBC文件
						</Button>
					</div>

					<div style={{ maxHeight: "300px", overflow: "auto" }}>
						<CodeBlock source={dbcSource} />
					</div>
				</div>

				<div
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						padding: "16px",
						borderRadius: "4px",
						border: "1px solid var(--vscode-panel-border)",
					}}>
					<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
						确认说明：
					</Text>
					<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
						<li>DBC文件已根据矩阵定义生成</li>
						<li>文件内容已通过基本格式验证</li>
						<li>确认后将继续转换为C/Java代码</li>
					</ul>
				</div>

				<div style={{ display: "flex", justifyContent: "flex-end" }}>
					<Button icon={<CheckOutlined />} onClick={onConfirm} type="primary">
						确认并继续转换为代码
					</Button>
				</div>
			</Space>
		</Card>
	)
}

export default ConfirmDbcFile
