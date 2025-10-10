import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import styled from "styled-components"
import MatrixParseAskMessage from "./MatrixParseAskMessage.tsx"
import MatrixParseSayMessage from "./MatrixParseSayMessage.tsx"
import { MatrixParseAsk, MatrixParseSay } from "./matrixParseMessages"

const MessageContainer = styled.div`
  &:not(:last-child) {
    border-bottom: 1px solid var(--vscode-panel-border)
  }
`

interface MatrixParseMessageRendererProps {
	index: number
	message: ClineMessage
	isLast: boolean
	onAction: (action: string, data?: any) => void
}

const MatrixParseMessageRenderer: React.FC<MatrixParseMessageRendererProps> = ({ index, message, isLast, onAction }) => {
	const handleAction = (action: string, data?: any) => {
		onAction(action, data)
	}

	// 根据消息类型渲染不同的组件
	if (message.type === "ask") {
		return (
			<MessageContainer>
				<MatrixParseAskMessage message={message} onAction={handleAction} />
			</MessageContainer>
		)
	} else if (message.type === "say") {
		const sayType = message.say as unknown as MatrixParseSay
		return (
			<MessageContainer>
				<MatrixParseSayMessage isLast={isLast} message={message} sayType={sayType} />
			</MessageContainer>
		)
	}

	// 默认渲染
	return (
		<MessageContainer>
			<div style={{ padding: "10px 15px" }}>
				<div style={{ color: "var(--vscode-foreground)" }}>{message.text || "未知消息"}</div>
			</div>
		</MessageContainer>
	)
}

export default MatrixParseMessageRenderer
