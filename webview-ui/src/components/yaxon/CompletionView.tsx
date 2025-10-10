import { CheckCircleOutlined, DownloadOutlined, FileDoneOutlined, ReloadOutlined } from "@ant-design/icons"
import { Button, Card, Result, Space, Typography } from "antd"
import React from "react"
import CodeBlock from "@/components/common/CodeBlock"

const { Title, Text } = Typography

interface CompletionViewProps {
	generatedCode: string
	language: "c" | "java"
	onReset: () => void
	onDownload: () => void
}

const CompletionView: React.FC<CompletionViewProps> = ({ generatedCode, language, onReset, onDownload }) => {
	// 创建符合CodeBlock要求的源代码格式
	const codeSource = `\`\`\`${language}
${generatedCode}
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
				<Result
					icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
					status="success"
					subTitle={
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>
							已成功根据DBC文件生成{language.toUpperCase()}代码并完成语法检查
						</span>
					}
					title={<span style={{ color: "var(--vscode-foreground)" }}>代码生成完成！</span>}
				/>

				<div>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "12px",
						}}>
						<Title
							level={5}
							style={{
								color: "var(--vscode-foreground)",
								margin: 0,
							}}>
							<FileDoneOutlined /> 生成的{language.toUpperCase()}代码：
						</Title>
						<Button icon={<DownloadOutlined />} onClick={onDownload}>
							下载代码文件
						</Button>
					</div>

					<div style={{ maxHeight: "300px", overflow: "auto" }}>
						<CodeBlock source={codeSource} />
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
						处理完成说明：
					</Text>
					<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
						<li>代码已根据预定义编码规范生成</li>
						<li>已完成语法检查和错误修正</li>
						<li>代码文件已输出到您的项目目录中</li>
						<li>您可以继续进行其他矩阵文件的处理</li>
					</ul>
				</div>

				<div style={{ display: "flex", justifyContent: "center" }}>
					<Button icon={<ReloadOutlined />} onClick={onReset}>
						处理新的矩阵文件
					</Button>
				</div>
			</Space>
		</Card>
	)
}

export default CompletionView
