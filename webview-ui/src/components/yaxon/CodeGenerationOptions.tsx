import { CheckOutlined, CoffeeOutlined } from "@ant-design/icons"
import { Button, Card, Radio, Space, Typography } from "antd"
import React from "react"

const { Title, Text } = Typography

interface CodeGenerationOptionsProps {
	onGenerate: (language: "c" | "java") => void
	isProcessing: boolean
}

const CodeGenerationOptions: React.FC<CodeGenerationOptionsProps> = ({ onGenerate, isProcessing }) => {
	const [selectedLanguage, setSelectedLanguage] = React.useState<"c" | "java">("c")

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
						level={4}
						style={{
							color: "var(--vscode-foreground)",
							marginTop: 0,
							marginBottom: "16px",
						}}>
						选择代码生成选项
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>请选择要生成的代码语言类型</Text>
				</div>

				<div>
					<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "12px" }}>
						目标语言：
					</Text>
					<Radio.Group
						disabled={isProcessing}
						onChange={(e) => setSelectedLanguage(e.target.value)}
						value={selectedLanguage}>
						<Space direction="vertical">
							<Radio style={{ color: "var(--vscode-foreground)" }} value="c">
								<CoffeeOutlined /> C语言
								<Text
									style={{ color: "var(--vscode-descriptionForeground)", display: "block", fontSize: "12px" }}>
									生成符合AUTOSAR标准的C代码，适用于嵌入式系统开发
								</Text>
							</Radio>
							<Radio style={{ color: "var(--vscode-foreground)" }} value="java">
								<CoffeeOutlined /> Java语言
								<Text
									style={{ color: "var(--vscode-descriptionForeground)", display: "block", fontSize: "12px" }}>
									生成面向对象的Java代码，适用于上位机应用开发
								</Text>
							</Radio>
						</Space>
					</Radio.Group>
				</div>

				<div
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						padding: "16px",
						borderRadius: "4px",
						border: "1px solid var(--vscode-panel-border)",
					}}>
					<Text style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
						代码生成说明：
					</Text>
					<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
						<li>根据DBC文件定义自动生成CAN消息解析代码</li>
						<li>包含消息结构体定义、信号解析函数等</li>
						<li>遵循预定义的编码规范和最佳实践</li>
						<li>生成后将进行语法检查和错误修正</li>
					</ul>
				</div>

				<div style={{ display: "flex", justifyContent: "flex-end" }}>
					<Button
						icon={<CheckOutlined />}
						loading={isProcessing}
						onClick={() => onGenerate(selectedLanguage)}
						type="primary">
						开始生成{selectedLanguage.toUpperCase()}代码
					</Button>
				</div>
			</Space>
		</Card>
	)
}

export default CodeGenerationOptions
