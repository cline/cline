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

const { Title, Text } = Typography

interface MatrixParseViewProps {
	onBack?: () => void,
	onSwitchToChat: () => void,
	task: ClineMessage | undefined,
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	scrollBehavior: ScrollBehavior,
	chatState: ChatState,
	messageHandlers: MessageHandlers,
}

// 创建与ChatLayout类似的布局容器
const MatrixLayoutContainer = styled.div.withConfig({
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

const MatrixParseView: React.FC<MatrixParseViewProps> = ({ onBack,onSwitchToChat,task,groupedMessages,modifiedMessages,scrollBehavior,chatState,messageHandlers}) => {
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

	// 消息处理



	// 处理文件选择
	const handleFileSelect = async () => {
		try {
			// 创建文件输入元素
			const input = document.createElement("input")
			input.type = "file"
			input.accept = ".xlsx,.xls"
			input.style.display = "none"

			// 设置文件选择回调
			input.onchange = async (event) => {
				const file = (event.target as HTMLInputElement).files?.[0]
				if (file) {
					// 验证文件类型
					if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
						message.error("请选择Excel文件 (.xlsx 或 .xls)")
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
					console.log("[MatrixParseView] Calling MatrixService to process file:", file.name)

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
				
				await TaskServiceClient.newTask(
					NewTaskRequest.create({
						text: `${MatrixFileParsePrompt()}\n处理上传的CAN矩阵文件，
						在每一步与用户进行交互\n\n文件URL: ${fileUrl}\n\n**矩阵文件的Sheet列表**: ${sheetNames}`,
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

	// 处理DBC文件下载
	const handleDownloadDbc = (dbcContent: string, fileName: string) => {
		const blob = new Blob([dbcContent], { type: "text/plain" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = fileName
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	// 处理代码下载
	const handleDownloadCode = (codeContent: string, language: string, fileName: string) => {
		const blob = new Blob([codeContent], { type: "text/plain" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = fileName
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	// 处理任务完成
	const handleCompleteTask = () => {
		// 重置状态并重新开始
		setMessages([MatrixParseMessageFactory.createUploadFileAsk()])
		setSelectedFileName("")
		setSelectedFilePath("")
	}

	// 处理DBC转换结果
	const handleDbcConversionResult = async (dbcContent: string, fileName: string) => {
		try {
			// 移除对未定义状态变量 dbcContent 和 setDbcContent 的调用
			// dbcContent现在作为参数传入函数

			// 添加DBC转换完成消息
			const conversionCompleteMessage = MatrixParseMessageFactory.createSay("dbc_conversion_completed", "DBC文件转换完成")

			// 添加DBC验证开始消息
			const validationStartMessage = MatrixParseMessageFactory.createSay("dbc_validation_started", "正在验证DBC文件...")

			setMessages((prev) => [...prev, conversionCompleteMessage, validationStartMessage])

			// 请求Agent验证DBC文件
			const validationRequestMessage = MatrixParseMessageFactory.createSay(
				"agent_request",
				"正在请求AI Agent验证DBC文件...",
				{
					requestType: "validate_dbc_file",
					dbcContent: dbcContent,
				},
			)

			setMessages((prev) => [...prev, validationRequestMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`处理DBC转换结果时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// 处理DBC验证结果
	const handleDbcValidationResult = async (validationResult: any) => {
		try {
			// 添加DBC验证完成消息
			const validationCompleteMessage = MatrixParseMessageFactory.createSay("dbc_validation_completed", "DBC文件验证完成", {
				isValid: validationResult.isValid,
				errors: validationResult.errors,
			})

			// 添加确认DBC转换的询问消息
			const confirmDbcMessage = MatrixParseMessageFactory.createConfirmDbcAsk(
				validationResult.dbcContent,
				validationResult.fileName,
			)

			setMessages((prev) => [...prev, validationCompleteMessage, confirmDbcMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`处理DBC验证结果时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// 处理代码生成结果
	const handleCodeGenerationResult = async (codeResult: any) => {
		try {
			// 移除对未定义状态变量 generatedCode 和 setGeneratedCode 的调用
			// generatedCode现在作为参数传入函数

			// 添加代码生成完成消息
			const generationCompleteMessage = MatrixParseMessageFactory.createSay(
				"code_generation_completed",
				`${codeResult.language.toUpperCase()}代码生成完成`,
			)

			// 添加代码验证开始消息
			const validationStartMessage = MatrixParseMessageFactory.createSay("code_validation_started", "正在验证生成的代码...")

			setMessages((prev) => [...prev, generationCompleteMessage, validationStartMessage])

			// 请求Agent验证生成的代码
			const validationRequestMessage = MatrixParseMessageFactory.createSay(
				"agent_request",
				"正在请求AI Agent验证生成的代码...",
				{
					requestType: "validate_generated_code",
					codeContent: codeResult.codeContent,
					language: codeResult.language,
				},
			)

			setMessages((prev) => [...prev, validationRequestMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`处理代码生成结果时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// 处理代码验证结果
	const handleCodeValidationResult = async (validationResult: any) => {
		try {
			// 添加代码验证完成消息
			const validationCompleteMessage = MatrixParseMessageFactory.createSay("code_validation_completed", "代码验证完成", {
				isValid: validationResult.isValid,
				errors: validationResult.errors,
			})

			// 添加代码审查询问消息
			const reviewCodeMessage = MatrixParseMessageFactory.createReviewCodeAsk(
				validationResult.codeContent,
				validationResult.language,
				validationResult.fileName,
			)

			setMessages((prev) => [...prev, validationCompleteMessage, reviewCodeMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`处理代码验证结果时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		}
	}

	// 处理DBC确认
	const handleDbcConfirmed = async () => {
		// 修改检查条件，不再依赖 dbcContent 状态变量
		// dbcContent 现在应该从函数参数或上下文中获取
		// 暂时移除检查，因为 dbcContent 不再是组件状态
		setIsProcessing(true)

		try {
			// 添加代码生成选项询问消息
			const confirmCodeMessage = MatrixParseMessageFactory.createConfirmCodeGenerationAsk()
			setMessages((prev) => [...prev, confirmCodeMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`确认DBC文件时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		} finally {
			setIsProcessing(false)
		}
	}

	// 处理代码生成
	const handleGenerateCode = async (language: "c" | "java") => {
		setIsProcessing(true)

		try {
			// 添加代码生成开始消息
			const generationStartMessage = MatrixParseMessageFactory.createSay(
				"code_generation_started",
				`正在生成${language.toUpperCase()}代码...`,
			)

			setMessages((prev) => [...prev, generationStartMessage])

			// 从消息历史中查找最新的DBC内容
			// 在用户确认DBC文件后，我们会收到包含dbcContent的消息
			let latestDbcContent = ""
			for (let i = messages.length - 1; i >= 0; i--) {
				const msg = messages[i]
				// 根据MatrixParseMessageFactory的实现，额外数据是直接附加到消息对象上的
				if ((msg as any).dbcContent && msg.ask === ("confirm_dbc_conversion" as any)) {
					latestDbcContent = (msg as any).dbcContent
					break
				}
				// 或者从之前的转换结果中获取
				if ((msg as any).dbcContent && msg.say === ("dbc_conversion_result" as any)) {
					latestDbcContent = (msg as any).dbcContent
					break
				}
			}

			// 如果没有找到DBC内容，显示错误消息
			if (!latestDbcContent) {
				const errorMessage = MatrixParseMessageFactory.createSay("error", "无法获取DBC文件内容，请先完成DBC文件转换")
				setMessages((prev) => [...prev, errorMessage])
				return
			}

			// 请求Agent生成代码
			const codeGenerationRequestMessage = MatrixParseMessageFactory.createSay(
				"agent_request",
				"正在请求AI Agent生成代码...",
				{
					requestType: "generate_code",
					dbcContent: latestDbcContent,
					language: language,
				},
			)

			setMessages((prev) => [...prev, codeGenerationRequestMessage])
		} catch (error) {
			const errorMessage = MatrixParseMessageFactory.createSay(
				"error",
				`生成代码时出错: ${error instanceof Error ? error.message : String(error)}`,
			)
			setMessages((prev) => [...prev, errorMessage])
		} finally {
			setIsProcessing(false)
		}
	}

	// 处理消息操作
	const handleMessageAction = useCallback(async (action: string, data?: any) => {
		switch (action) {
			case "file_uploaded":
				if (data?.file && data?.filePath) {
					// 移除对未定义状态变量 setSelectedFile 的调用
					setSelectedFileName(data.file.name)
					setSelectedFilePath(data.filePath)
				}
				break
			case "dbc_confirmed":
				await handleDbcConfirmed()
				break
			case "generate_code":
				await handleGenerateCode(data.language)
				break
			case "download_dbc":
				handleDownloadDbc(data.dbcContent, data.fileName)
				break
			case "download_code":
				handleDownloadCode(data.codeContent, data.language, data.fileName)
				break
			case "complete_task":
				handleCompleteTask()
				break
			case "dbc_conversion_result":
				// 处理来自Agent的DBC转换结果
				await handleDbcConversionResult(data.dbcContent, data.fileName)
				break
			case "dbc_validation_result":
				// 处理来自Agent的DBC验证结果
				await handleDbcValidationResult(data)
				break
			case "code_generation_result":
				// 处理来自Agent的代码生成结果
				await handleCodeGenerationResult(data)
				break
			case "code_validation_result":
				// 处理来自Agent的代码验证结果
				await handleCodeValidationResult(data)
				break
		}
	}, [])

	// 启动工作流并传递文件URL
	const startWorkflowWithFileUrl = async (fileUrl: string) => {
		try {
			const { TaskServiceClient } = await import("@/services/grpc-client")
			const { NewTaskRequest } = await import("@shared/proto/cline/task")

			// 创建新任务请求，使用工作流文件作为驱动逻辑
			// 将文件URL作为参数传递给工作流
			await TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: `/matrix-parse-interactive.md\n处理上传的CAN矩阵文件，在每一步与用户进行交互\n\n文件URL: ${fileUrl}`,
					images: [],
				}),
			)

			// 添加成功启动的消息
			const processingSuccessMessage = MatrixParseMessageFactory.createSay(
				"workflow_step",
				"工作流已成功启动，请在新任务中查看处理进度",
			)
			setMessages((prev) => [...prev, processingSuccessMessage])
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
	}

	return (
		<MatrixLayoutContainer>
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
								矩阵报文解析:
							</Title>
							<Text style={{ color: "var(--vscode-descriptionForeground)" }}>矩阵文件解析与CAN报文分析工具</Text>
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
													选择CAN功能矩阵定义文件
												</Title>
												<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
													请选择本地的CAN功能矩阵定义Excel文件，支持格式：.xlsx, .xls
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
									{/* {task && (<MessagesArea	chatState={chatState}
															groupedMessages={groupedMessages}
															messageHandlers={messageHandlers}
															modifiedMessages={modifiedMessages}
															scrollBehavior={scrollBehavior}
															task={task}
														/>
													)} */}

								<div style={{ flex: 1, minHeight: 0 }}>
								
{/* 
									<MatrixParseMessagesArea
									 messages={groupedMessages as ClineMessage[]}
									  onMessageAction={handleMessageAction}
									   />
									    */}
								</div>
							</>
						)}

						{showMcpDemo && (
							<div style={{ textAlign: "center" }}>
								<Button onClick={() => setShowMcpDemo(false)} style={{ marginTop: "16px" }}>
									返回矩阵解析
								</Button>
							</div>
						)}
					</Space>
				</div>
			</MainContent>
		</MatrixLayoutContainer>
	)
}

export default MatrixParseView
