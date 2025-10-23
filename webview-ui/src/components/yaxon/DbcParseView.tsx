import { ArrowLeftOutlined, CloseOutlined, CodeOutlined, FolderOpenOutlined, PlayCircleOutlined } from "@ant-design/icons"
import { ClineMessage } from "@shared/ExtensionMessage"
import { Button, Card, message, Space, Typography } from "antd"
import React, { useCallback, useEffect, useState } from "react"
import styled from "styled-components"
import { MatrixServiceClient } from "../../services/grpc-client"
import MatrixParseMessagesArea from "./MatrixParseMessagesArea"
import McpFileSelectorDemo from "./McpFileSelectorDemo"
import { MatrixParseMessageFactory } from "./matrixParseMessages"
import { MatrixFileParsePrompt } from "./prompts/MatrixParsePrompt"
import { ChatState, MessageHandlers, ScrollBehavior } from "@/components/chat/chat-view/types/chatTypes"
import {  getTaskMessage,  MessagesArea, useChatState, useMessageHandlers } from "../chat/chat-view"
import { DbcFileParsePrompt } from "./prompts/DbcParsePrompt"
import { Dbc2MatrixFileParsePrompt } from "./prompts/Dbc2MatrixParsePrompt"

const { Title, Text } = Typography

interface DbcParseViewProps {
	onBack?: () => void,
	onSwitchToChat: () => void,
	task: ClineMessage | undefined,
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	scrollBehavior: ScrollBehavior,
	chatState: ChatState,
	messageHandlers: MessageHandlers,
	type: "dbc2code" | "dbc2matrix"
}

// 创建与ChatLayout类似的布局容器
const DbcLayoutContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isHidden"].includes(prop),
})<{ isHidden?: boolean }>`
	display: ${(props) => (props.isHidden ? "none" : "grid")};
	grid-template-rows: auto 1fr;
	overflow: hidden;
	padding: 0;
	margin: 0;
	width: 100%;
	height: 100%;
	min-height: 100vh;
	position: relative;
`

const MainContent = styled.div`
	display: flex;
	flex-direction: column;
	overflow: hidden;
	grid-row: 2;
`

const UploadCard = styled(Card)`
  background-color: var(--vscode-sideBar-background);
  border-color: var(--vscode-panel-border);
  margin-bottom: 20px;
  
  .ant-card-body {
    background-color: var(--vscode-sideBar-background);
    padding: 24px;
  }
`

const DbcParseView: React.FC<DbcParseViewProps> = ({ onBack,onSwitchToChat,task,groupedMessages,modifiedMessages,scrollBehavior,chatState,messageHandlers,type}) => {
	const [messages, setMessages] = useState<ClineMessage[]>([])
	const [isProcessing, setIsProcessing] = useState(false)
	const [selectedFileName, setSelectedFileName] = useState<string>("")
	const [selectedFilePath, setSelectedFilePath] = useState<string>("")
	const [showMcpDemo, setShowMcpDemo] = useState(false)
	const [fileUrl, setFileUrl] = useState<string>("") // 添加存储文件URL的状态
	const [isFileProcessed, setIsFileProcessed] = useState(false) // 添加文件是否已处理完成的状态
	const [sheetNames, setSheetNames] = useState<string[]>([])

	// 在state定义中添加sheetName的状态变量
	const [sheetName, setSheetName] = useState<string>("")

	const header = (
		<div className="flex items-center p-2 border-b border-gray-200 dark:border-gray-700" style={{ gridRow: "1" }}>
			{onBack && (
				<Button
					icon={<ArrowLeftOutlined />}
					onClick={onBack}
					style={{
						color: "var(--vscode-textLink-foreground)",
					}}
					type="text">
					返回菜单
				</Button>
			)}
		</div>
	)

	// 处理来自扩展的消息
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcp_tool_response") {
				try {
					const result = JSON.parse(message.result) as {
						filePath?: string
						fileUrl?: string
						canceled: boolean
						error?: string
					}

					if (result.error) {
						throw new Error(result.error)
					}

					if (result.canceled) {
						message.info("文件选择已取消")
						return
					}

					if (result.filePath) {
						const fileName = result.filePath.split(/[/\\]/).pop() || result.filePath

						// 保存文件路径信息
						setSelectedFilePath(result.filePath)
						setSelectedFileName(fileName)

						// 显示成功消息
						message.success(`文件已选择: ${fileName}`)
					}

					// 处理MCP Server返回的文件URL
					if (result.fileUrl) {
						// 保存文件URL并设置处理完成状态
						setFileUrl(result.fileUrl)
						setIsFileProcessed(true)

						// 添加处理完成的消息
						const processingCompleteMessage = MatrixParseMessageFactory.createSay(
							"workflow_step",
							"文件处理完成，可以开始处理",
						)
						setMessages((prev) => [...prev, processingCompleteMessage])
					}
				} catch (error) {
					console.error("Failed to parse MCP tool response:", error)
					message.error("解析文件处理结果失败: " + (error instanceof Error ? error.message : String(error)))
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// 初始化消息
	useEffect(() => {
		const initialMessage = MatrixParseMessageFactory.createUploadFileAsk()
		setMessages([initialMessage])
	}, [])

		// 处理文件选择
	const handleFileSelect = async () => {
		try {
			// 创建文件输入元素
			const input = document.createElement("input")
			input.type = "file"
			input.accept = ".dbc,.DBC"
			input.style.display = "none"

			// 设置文件选择回调
			input.onchange = async (event) => {
				const file = (event.target as HTMLInputElement).files?.[0]
				if (file) {
					// 验证文件类型
					if ( !file.name.toLowerCase().endsWith(".dbc")) {
						message.error("请选择Excel文件 (.dbc)")
						return
					}

					// 保存文件信息
					setSelectedFileName(file.name)
					setSelectedFilePath("") // 清除之前的文件路径
					setFileUrl("") // 清除之前的文件URL
					setIsFileProcessed(false) // 重置处理状态

					// 显示成功消息
					message.success(`文件已选择: ${file.name}`)

					// 读取文件内容
					const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
						const reader = new FileReader()
						reader.onload = (e) => resolve(e.target?.result as ArrayBuffer)
						reader.onerror = reject
						reader.readAsArrayBuffer(file)
					})

					// 显示处理中消息
					const processingMessage = MatrixParseMessageFactory.createSay(
						"workflow_step",
						"正在调用 MatrixService 处理文件...",
					)
					setMessages((prev) => [...prev, processingMessage])

					// 调用 MatrixService 处理文件

					// 将ArrayBuffer转换为Uint8Array
					const uint8Array = new Uint8Array(fileContent)

					// 直接构造请求对象，避免使用ProcessMatrixRequest.create触发Buffer相关代码
					const request = {
						fileName: file.name,
						fileContent: uint8Array,
						fileSize: file.size,
					} as any

					// 创建一个临时的MatrixServiceClient类来调用服务
					try {
						const response = await MatrixServiceClient.processMatrixFile(request)				
					
						

						if (response.status === "success" && response.fileUrl) {
							// 保存处理结果
							setFileUrl(response.fileUrl)
							setIsFileProcessed(true)
							setSheetNames(response.sheetNames)
							console.log(response.sheetNames)

							// 添加处理完成的消息
							const processingCompleteMessage = MatrixParseMessageFactory.createSay(
								"workflow_step",
								"文件处理完成，可以开始处理",
							)
							setMessages((prev) => [...prev, processingCompleteMessage])
						} else {
							throw new Error(response.error || "文件处理失败")
						}
					} catch (clientError) {
						console.error("[MatrixParseView] MatrixServiceClient error:", clientError)
						// 提供更友好的错误信息
						const errorMessage = clientError instanceof Error ? clientError.message : String(clientError)
						throw new Error("无法连接到 MatrixService: " + errorMessage)
					}
				}
			}

			// 触发文件选择对话框
			document.body.appendChild(input)
			input.click()
			document.body.removeChild(input)
		} catch (error) {
			console.error("Failed to select file:", error)
			message.error("文件选择失败: " + (error instanceof Error ? error.message : String(error)))

			// 添加错误消息到消息列表中
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`文件选择失败: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// 移除设置环境变量的函数，因为根据规范不应使用环境变量方式传递上下文
	// 文件路径将通过任务系统上下文传递

	// 取消文件选择
	const handleCancelFile = () => {
		setSelectedFileName("")
		setSelectedFilePath("")
		setFileUrl("")
		setIsFileProcessed(false)
	}

	// 开始处理文件 - 使用交互式Workflow
	const handleStartProcessing = async () => {
		if (isFileProcessed && fileUrl) {
			try {
				// 添加开始处理的消息
				const processingStartMessage = MatrixParseMessageFactory.createSay("workflow_step", "正在启动矩阵解析工作流...")
				setMessages((prev) => [...prev, processingStartMessage])

				// 使用TaskServiceClient触发交互式处理流程
				const { TaskServiceClient } = await import("@/services/grpc-client")
				const { NewTaskRequest } = await import("@shared/proto/cline/task")

				// 创建新任务请求，使用工作流文件作为驱动逻辑
				// 将文件URL作为参数传递给工作流

				const prompt=(type==="dbc2code")?DbcFileParsePrompt():Dbc2MatrixFileParsePrompt();	
				
				await TaskServiceClient.newTask(
					NewTaskRequest.create({
						text: `${prompt}\n处理上传的DBC文件，
						在每一步与用户进行交互\n\n文件URL: ${fileUrl}\n\n**DBC文件的Sheet列表**: ${sheetNames}`,
						images: [],
					}),
				)
				onSwitchToChat()
			
			} catch (error) {
				console.error("Failed to start matrix parse workflow:", error)
				message.error("启动工作流失败: " + (error instanceof Error ? error.message : String(error)))

				// 添加错误消息到消息列表中
				const errorMessage = MatrixParseMessageFactory.createSay(
					"error",
					`启动工作流失败: ${error instanceof Error ? error.message : String(error)}`,
				)
				setMessages((prev) => [...prev, errorMessage])
			}
		} else {
			message.warning("请先选择并处理一个文件")
		}
	}

	return (
		<DbcLayoutContainer>
			{header}
			<MainContent>
				<div style={{ padding: "20px", height: "100%", display: "flex", flexDirection: "column" }}>
					<Space direction="vertical" size="large" style={{ width: "100%", flex: 1 }}>
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
								<CodeOutlined />
								DBC解析2:
							</Title>
							<Text style={{ color: "var(--vscode-descriptionForeground)" }}>DBC分析工具</Text>
						</div>

						{showMcpDemo ? (
							<McpFileSelectorDemo />
						) : (
							<>
								<UploadCard>
									<Space direction="vertical" size="large" style={{ width: "100%" }}>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<div>
												<Title
													level={4}
													style={{
														color: "var(--vscode-foreground)",
														marginTop: 0,
														marginBottom: "16px",
													}}>
													选择Dbc文件
												</Title>
												<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
													请选择本地的Dbc文件，支持格式：.dbc
												</Text>
											</div>
										
										</div>

										<div>
											{selectedFileName ? (
												<div style={{ display: "flex", gap: "12px", flexDirection: "column" }}>
													<div style={{ display: "flex", gap: "12px" }}>
														<Button
															disabled={isProcessing}
															icon={<FolderOpenOutlined />}
															onClick={handleFileSelect}
															style={{ flex: 1 }}
															type="primary">
															重新选择文件
														</Button>
														<Button
															danger
															disabled={isProcessing}
															icon={<CloseOutlined />}
															onClick={handleCancelFile}>
															取消
														</Button>
													</div>
													{isFileProcessed && fileUrl ? (
														<Button
															icon={<PlayCircleOutlined />}
															onClick={() => {
																
																handleStartProcessing();
															}}
															size="large"
															style={{ width: "100%" }}
															type="primary">
															开始处理
														</Button>
													) : (
														<Button
															icon={<PlayCircleOutlined />}
															onClick={handleStartProcessing}
															size="large"
															style={{ width: "100%" }}
															type="primary">
															处理文件
														</Button>
													)}
												</div>
											) : (
												<Button
													disabled={isProcessing}
													icon={<FolderOpenOutlined />}
													onClick={handleFileSelect}
													size="large"
													style={{ width: "100%" }}
													type="primary">
													选择文件
												</Button>
											)}
											
										</div>
									</Space>
								</UploadCard>
								

								<div style={{ flex: 1, minHeight: 0 }}>

								</div>
							</>
						)}

						
					</Space>
				</div>
			</MainContent>
		</DbcLayoutContainer>
	)
}

export default DbcParseView
