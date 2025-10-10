import { ClineMessage } from "@shared/ExtensionMessage"
import { Button, Card, message, Select, Space, Typography } from "antd"
import React from "react"
import styled from "styled-components"
import { MatrixParseAsk } from "./matrixParseMessages"

const { Text } = Typography

const MessageCard = styled(Card)`
  background-color: var(--vscode-sideBar-background);
  border-color: var(--vscode-panel-border);
  
  .ant-card-body {
    background-color: var(--vscode-sideBar-background);
    padding: 12px 16px;
  }
`

interface MatrixParseAskMessageProps {
	message: ClineMessage
	onAction: (action: string, data?: any) => void
}

const MatrixParseAskMessage: React.FC<MatrixParseAskMessageProps> = ({ message, onAction }) => {
	// 解析消息内容
	const messageData = message.text ? JSON.parse(message.text) : {}
	const askType = message.ask as unknown as MatrixParseAsk

	const handleAction = (action: string, data?: any) => {
		onAction(action, data)
	}

	const renderAskContent = () => {
		switch (askType) {
			case "upload_matrix_file":
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Button onClick={() => handleAction("select_file")} size="small" type="primary">
								选择文件
							</Button>
							<Button onClick={() => handleAction("cancel_file")} size="small">
								取消
							</Button>
						</Space>
					</Space>
				)

			case "confirm_dbc_conversion":
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Button
								onClick={() =>
									handleAction("dbc_confirmed", {
										dbcContent: messageData.dbcContent,
										fileName: messageData.fileName,
									})
								}
								size="small"
								type="primary">
								确认转换结果
							</Button>
							<Button onClick={() => handleAction("cancel_file")} size="small">
								重新选择文件
							</Button>
						</Space>
					</Space>
				)

			case "confirm_code_generation":
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Select
								defaultValue="c"
								onChange={(value) => {
									// 保存用户选择但不立即执行
								}}
								options={[
									{ value: "c", label: "C 语言" },
									{ value: "java", label: "Java" },
								]}
								size="small"
								style={{ width: 120 }}
							/>
							<Button
								onClick={() => {
									const selectElement = document.querySelector(".ant-select-selector") as HTMLElement
									const selectedValue = selectElement?.textContent?.includes("Java") ? "java" : "c"
									handleAction("generate_code", { language: selectedValue })
								}}
								size="small"
								type="primary">
								生成代码
							</Button>
							<Button onClick={() => handleAction("cancel_file")} size="small">
								取消
							</Button>
						</Space>
					</Space>
				)

			case "review_generated_code":
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Button
								onClick={() =>
									handleAction("download_code", {
										codeContent: messageData.codeContent,
										language: messageData.language,
										fileName: messageData.fileName,
									})
								}
								size="small"
								type="primary">
								下载代码
							</Button>
							<Button onClick={() => handleAction("complete_task")} size="small">
								完成任务
							</Button>
						</Space>
					</Space>
				)

			case "user_confirmation":
			case "user_feedback":
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Button
								onClick={() => handleAction("confirm", { step: messageData.step })}
								size="small"
								type="primary">
								确认
							</Button>
							<Button onClick={() => handleAction("cancel", { step: messageData.step })} size="small">
								取消
							</Button>
						</Space>
					</Space>
				)

			default:
				return (
					<Space direction="vertical" size="small" style={{ width: "100%" }}>
						<Text style={{ color: "var(--vscode-foreground)", fontSize: "14px" }}>{messageData}</Text>
						<Space>
							<Button onClick={() => handleAction("confirm")} size="small" type="primary">
								确认
							</Button>
							<Button onClick={() => handleAction("cancel")} size="small">
								取消
							</Button>
						</Space>
					</Space>
				)
		}
	}

	return <MessageCard size="small">{renderAskContent()}</MessageCard>
}

export default MatrixParseAskMessage
