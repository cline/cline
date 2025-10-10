import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, SyncOutlined } from "@ant-design/icons"
import { Card, Space, Steps, Typography } from "antd"
import React from "react"

const { Title, Text } = Typography

interface ProcessingStatusProps {
	currentStep: number
	status: "process" | "finish" | "error"
	message: string
	details?: string
}

const ProcessingStatus: React.FC<ProcessingStatusProps> = ({ currentStep, status, message, details }) => {
	const steps = [
		{
			title: "文件上传",
			description: "上传CAN功能矩阵定义文件",
		},
		{
			title: "转换DBC",
			description: "将矩阵文件转换为标准DBC文件",
		},
		{
			title: "验证DBC",
			description: "验证DBC文件内容有效性",
		},
		{
			title: "生成代码",
			description: "根据DBC文件生成C/Java代码",
		},
		{
			title: "验证代码",
			description: "检查生成代码的语法和规范",
		},
		{
			title: "完成",
			description: "输出最终代码文件",
		},
	]

	const getStatusIcon = (stepIndex: number) => {
		if (stepIndex < currentStep) {
			return <CheckCircleOutlined style={{ color: "#52c41a" }} />
		} else if (stepIndex === currentStep) {
			if (status === "error") {
				return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
			} else if (status === "finish") {
				return <CheckCircleOutlined style={{ color: "#52c41a" }} />
			} else {
				return <LoadingOutlined />
			}
		} else {
			return <SyncOutlined />
		}
	}

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
						处理中...
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>系统正在处理您的请求，请稍候</Text>
				</div>

				<div>
					<Steps
						current={currentStep}
						direction="vertical"
						items={steps.map((step, index) => ({
							key: index,
							title: <span style={{ color: "var(--vscode-foreground)" }}>{step.title}</span>,
							description: <span style={{ color: "var(--vscode-descriptionForeground)" }}>{step.description}</span>,
							icon: getStatusIcon(index),
						}))}
						size="small"
						status={status}
					/>
				</div>

				<div
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						padding: "16px",
						borderRadius: "4px",
						border: "1px solid var(--vscode-panel-border)",
					}}>
					<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
						当前状态：
					</Text>
					<Text style={{ color: "var(--vscode-foreground)", display: "block" }}>{message}</Text>
					{details && (
						<Text
							style={{
								color: "var(--vscode-descriptionForeground)",
								display: "block",
								fontSize: "12px",
								marginTop: "8px",
							}}>
							详细信息：{details}
						</Text>
					)}
				</div>
			</Space>
		</Card>
	)
}

export default ProcessingStatus
