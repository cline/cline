import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from "@ant-design/icons"
import { ClineMessage } from "@shared/ExtensionMessage"
import { Card, Space, Typography } from "antd"
import React from "react"
import styled from "styled-components"
import { MatrixParseSay } from "./matrixParseMessages"

const { Text } = Typography

const MessageCard = styled(Card)`
  background-color: var(--vscode-sideBar-background);
  border-color: var(--vscode-panel-border);
  
  .ant-card-body {
    background-color: var(--vscode-sideBar-background);
    padding: 12px 16px;
  }
`

interface MatrixParseSayMessageProps {
	sayType: MatrixParseSay
	message: ClineMessage
	isLast: boolean
}

const MatrixParseSayMessage: React.FC<MatrixParseSayMessageProps> = ({ sayType, message, isLast }) => {
	// 解析消息内容
	const messageData = message.text ? JSON.parse(message.text) : {}

	const getStatusIcon = () => {
		switch (sayType) {
			case "dbc_conversion_started":
			case "code_generation_started":
			case "dbc_validation_started":
			case "code_validation_started":
				return <LoadingOutlined style={{ color: "var(--vscode-textLink-foreground)" }} />
			case "dbc_conversion_completed":
			case "dbc_validation_completed":
			case "code_generation_completed":
			case "code_validation_completed":
			case "task_completed":
				return <CheckCircleOutlined style={{ color: "#52c41a" }} />
			case "error":
				return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />
			default:
				return null
		}
	}

	const getStatusColor = () => {
		switch (sayType) {
			case "error":
				return "#ff4d4f"
			case "dbc_conversion_completed":
			case "dbc_validation_completed":
			case "code_generation_completed":
			case "code_validation_completed":
			case "task_completed":
				return "#52c41a"
			default:
				return "var(--vscode-foreground)"
		}
	}

	const renderMessage = () => {
		let content = message.text || "系统消息"

		// 如果是JSON格式的消息内容，尝试解析并显示有意义的信息
		try {
			if (message.text && message.text.startsWith("{")) {
				const data = JSON.parse(message.text)
				if (data.message) {
					content = data.message
				} else if (data.fileName) {
					content = `${content} - ${data.fileName}`
				}
			}
		} catch (e) {
			// 如果解析失败，使用原始文本
		}

		return (
			<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
				{getStatusIcon()}
				<Text
					style={{
						color: getStatusColor(),
						fontSize: "14px",
					}}>
					{content}
				</Text>
			</div>
		)
	}

	return (
		<MessageCard size="small">
			<Space direction="vertical" size="small" style={{ width: "100%" }}>
				{renderMessage()}

				{/* 如果有验证结果，显示详细信息 */}
				{messageData.isValid !== undefined && (
					<div
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							padding: "8px",
							borderRadius: "4px",
							border: "1px solid var(--vscode-panel-border)",
							fontSize: "12px",
						}}>
						<Text style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "4px" }}>
							验证结果: {messageData.isValid ? "通过" : "未通过"}
						</Text>
						{messageData.errors && messageData.errors.length > 0 && (
							<div>
								<Text style={{ color: "#ff4d4f", display: "block" }}>错误信息:</Text>
								<ul style={{ color: "#ff4d4f", margin: "4px 0 0 20px", padding: 0 }}>
									{messageData.errors.map((error: string, index: number) => (
										<li key={index} style={{ marginBottom: "2px" }}>
											{error}
										</li>
									))}
								</ul>
							</div>
						)}
						{messageData.warnings && messageData.warnings.length > 0 && (
							<div>
								<Text style={{ color: "#faad14", display: "block", marginTop: "4px" }}>警告信息:</Text>
								<ul style={{ color: "#faad14", margin: "4px 0 0 20px", padding: 0 }}>
									{messageData.warnings.map((warning: string, index: number) => (
										<li key={index} style={{ marginBottom: "2px" }}>
											{warning}
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				)}
			</Space>
		</MessageCard>
	)
}

export default MatrixParseSayMessage
