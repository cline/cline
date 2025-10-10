import { ClineMessage } from "@shared/ExtensionMessage"
import React, { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import MatrixParseMessageRenderer from "./MatrixParseMessageRenderer"
import { MatrixParseSay } from "./matrixParseMessages"

interface MatrixParseMessagesAreaProps {
	messages: ClineMessage[]
	onMessageAction?: (action: string, data?: any) => void
}

const MatrixParseMessagesArea: React.FC<MatrixParseMessagesAreaProps> = ({ messages, onMessageAction }) => {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const autoScrollRef = useRef(true)

	// 滚动到底部的函数
	const scrollToBottom = () => {
		if (autoScrollRef.current && virtuosoRef.current && messages.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: messages.length - 1,
				behavior: "auto",
			})
		}
	}

	// 监听消息变化并自动滚动
	useEffect(() => {
		if (autoScrollRef.current) {
			// 短暂延迟确保DOM更新完成
			const timer = setTimeout(() => {
				scrollToBottom()
			}, 100)
			return () => clearTimeout(timer)
		}
	}, [messages.length])

	// 处理滚动事件
	const handleRangeChanged = (range: { startIndex: number; endIndex: number }) => {
		// 检查是否接近底部（最后5个消息以内）
		const isNearBottom = range.endIndex >= messages.length - 5
		autoScrollRef.current = isNearBottom
	}

	// 处理手动滚动到底部
	const handleScrollToBottom = () => {
		autoScrollRef.current = true
		scrollToBottom()
	}

	// 检查消息是否为 agent_request 类型
	const isAgentRequestMessage = (message: ClineMessage): boolean => {
		if (message.type === "say") {
			// 通过类型断言检查是否为 agent_request
			const sayType = message.say as unknown as MatrixParseSay
			return sayType === "agent_request"
		}
		return false
	}

	// 检查消息是否为 Workflow 相关的 task 类型
	const isTaskMessage = (message: ClineMessage): boolean => {
		return message.type === "say" && message.say === "task"
	}

	// 检查最后几条消息中是否有需要处理的 agent_request
	useEffect(() => {
		// 检查最后3条消息中是否有 agent_request
		const recentMessages = messages.slice(-3)
		const agentRequestMessage = recentMessages.find((msg) => isAgentRequestMessage(msg))

		if (agentRequestMessage) {
			// 处理 agent_request 消息
			handleAgentRequest(agentRequestMessage)
		}
	}, [messages])

	// 处理 agent_request 消息
	const handleAgentRequest = async (message: ClineMessage) => {
		try {
			// 解析消息内容
			let messageData: any = {}
			if (message.text) {
				try {
					// 如果 text 是 JSON 字符串，则解析它
					messageData = typeof message.text === "string" ? JSON.parse(message.text) : message.text
				} catch (e) {
					// 如果解析失败，将 text 作为普通字符串处理
					messageData = { text: message.text }
				}
			}

			// 合并消息对象中的额外数据
			const fullData = { ...messageData, ...(message as any) }

			// 通过 gRPC 调用触发 LLM 对话
			console.log("Processing agent request:", message, fullData)

			// 根据 requestType 执行不同的操作
			const requestType = fullData.requestType
			switch (requestType) {
				case "convert_matrix_to_dbc":
					// 发送请求到 TaskService 处理矩阵到DBC的转换
					console.log("正在将矩阵文件转换为DBC文件")
					try {
						// 在实际实现中，这里会调用相应的 gRPC 服务来处理请求
						// const response = await TaskServiceClient.processMatrixToDbc(fullData)
						// onMessageAction?.('dbc_conversion_result', response)

						// 模拟成功响应
						onMessageAction?.("agent_response", {
							status: "success",
							requestType,
							message: "矩阵到DBC转换任务已成功完成",
						})
					} catch (error: any) {
						console.error("gRPC call failed for convert_matrix_to_dbc:", error)
						onMessageAction?.("agent_response", {
							status: "error",
							requestType,
							message: "矩阵到DBC转换失败",
							error: error.message || "未知错误",
						})
					}
					break
				case "validate_dbc_file":
					// 验证DBC文件
					console.log("正在验证DBC文件")
					try {
						// const response = await TaskServiceClient.validateDbcFile(fullData)
						// onMessageAction?.('validation_result', response)

						// 模拟成功响应
						onMessageAction?.("agent_response", {
							status: "success",
							requestType,
							message: "DBC文件验证成功",
						})
					} catch (error: any) {
						console.error("gRPC call failed for validate_dbc_file:", error)
						onMessageAction?.("agent_response", {
							status: "error",
							requestType,
							message: "DBC文件验证失败",
							error: error.message || "未知错误",
						})
					}
					break
				case "generate_code_from_dbc":
					// 生成代码
					console.log("正在生成代码")
					try {
						// const response = await TaskServiceClient.generateCode(fullData)
						// onMessageAction?.('code_generation_result', response)

						// 模拟成功响应
						onMessageAction?.("agent_response", {
							status: "success",
							requestType,
							message: "代码生成成功",
						})
					} catch (error: any) {
						console.error("gRPC call failed for generate_code:", error)
						onMessageAction?.("agent_response", {
							status: "error",
							requestType,
							message: "代码生成失败",
							error: error.message || "未知错误",
						})
					}
					break
				case "validate_generated_code":
					// 验证生成的代码
					console.log("正在验证生成的代码")
					try {
						// const response = await TaskServiceClient.validateGeneratedCode(fullData)
						// onMessageAction?.('code_validation_result', response)

						// 模拟成功响应
						onMessageAction?.("agent_response", {
							status: "success",
							requestType,
							message: "生成的代码验证成功",
						})
					} catch (error: any) {
						console.error("gRPC call failed for validate_generated_code:", error)
						onMessageAction?.("agent_response", {
							status: "error",
							requestType,
							message: "生成的代码验证失败",
							error: error.message || "未知错误",
						})
					}
					break
				default:
					console.log("未知的请求类型:", requestType)
					onMessageAction?.("agent_response", {
						status: "error",
						requestType,
						message: "不支持的请求类型",
						error: `未知的请求类型: ${requestType}`,
					})
			}
		} catch (error) {
			console.error("Error processing agent request:", error)
			// 错误处理
			onMessageAction?.("error", {
				message: "处理AI请求时出错",
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-hidden">
				<Virtuoso
					data={messages}
					followOutput={"smooth"}
					itemContent={(index, message) => (
						<MatrixParseMessageRenderer
							index={index}
							isLast={index === messages.length - 1}
							message={message}
							onAction={onMessageAction || (() => {})}
						/>
					)}
					rangeChanged={handleRangeChanged}
					ref={virtuosoRef}
				/>
			</div>

			{/* 滚动到底部按钮 - 当不在底部时显示 */}
			{!autoScrollRef.current && (
				<div className="flex justify-center p-2">
					<button
						className="px-3 py-1 text-xs rounded-full bg-vscode-button-background hover:bg-vscode-button-hoverBackground text-vscode-button-foreground transition-colors"
						onClick={handleScrollToBottom}>
						滚动到底部
					</button>
				</div>
			)}
		</div>
	)
}

export default MatrixParseMessagesArea
