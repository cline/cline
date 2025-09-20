// 添加返回按钮相关的导入
import { ArrowLeftOutlined } from "@ant-design/icons"
import { findLast } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { BooleanRequest, StringRequest } from "@shared/proto/cline/common"
import { Button } from "antd"
import React, { useCallback, useEffect, useMemo } from "react"
import { useMount } from "react-use"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { Navbar } from "../menu/Navbar"
import AutoApproveBar from "./auto-approve-menu/AutoApproveBar"
// 从新结构中导入实用程序和钩子
import {
	ActionButtons,
	CHAT_CONSTANTS,
	ChatLayout,
	convertHtmlToMarkdown,
	filterVisibleMessages,
	groupMessages,
	InputSection,
	MessagesArea,
	TaskSection,
	useChatState,
	useMessageHandlers,
	useScrollBehavior,
	WelcomeSection,
} from "./chat-view"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

// 使用从导入模块获取的常量
const MAX_IMAGES_AND_FILES_PER_MESSAGE = CHAT_CONSTANTS.MAX_IMAGES_AND_FILES_PER_MESSAGE
const QUICK_WINS_HISTORY_THRESHOLD = 3

const IS_STANDALONE = window?.__is_standalone__ ?? false

const ChatView = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }: ChatViewProps) => {
	const {
		version,
		clineMessages: messages,
		taskHistory,
		apiConfiguration,
		telemetrySetting,
		navigateToChat,
		mode,
		userInfo,
		currentFocusChainChecklist,
	} = useExtensionState()
	const isProdHostedApp = userInfo?.apiBaseUrl === "https://app.cline.bot"
	const shouldShowQuickWins = isProdHostedApp && (!taskHistory || taskHistory.length < QUICK_WINS_HISTORY_THRESHOLD)

	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined) : undefined
	const task = useMemo(() => messages.at(0), [messages]) // 保留此不安全示例：如果第一条消息不是任务，扩展将处于错误状态，需要调试（参见 Cline.abort）
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	// 必须在 api_req_finished 全部合并为 api_req_started 消息之后
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const lastApiReqTotalTokens = useMemo(() => {
		const getTotalTokensFromApiReqMessage = (msg: ClineMessage) => {
			if (!msg.text) {
				return 0
			}
			const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(msg.text)
			return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
		}
		const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
			if (msg.say !== "api_req_started") {
				return false
			}
			return getTotalTokensFromApiReqMessage(msg) > 0
		})
		if (!lastApiReqMessage) {
			return undefined
		}
		return getTotalTokensFromApiReqMessage(lastApiReqMessage)
	}, [modifiedMessages])

	// 使用自定义钩子进行状态管理
	const chatState = useChatState(messages)
	const {
		setInputValue,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		sendingDisabled,
		enableButtons,
		expandedRows,
		setExpandedRows,
		textAreaRef,
	} = chatState

	useEffect(() => {
		const handleCopy = async (e: ClipboardEvent) => {
			const targetElement = e.target as HTMLElement | null
			// 如果复制事件源自输入框或文本区域，
			// 则让默认的浏览器行为处理它。
			if (
				targetElement &&
				(targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA" || targetElement.isContentEditable)
			) {
				return
			}

			if (window.getSelection) {
				const selection = window.getSelection()
				if (selection && selection.rangeCount > 0) {
					const range = selection.getRangeAt(0)
					const commonAncestor = range.commonAncestorContainer
					let textToCopy: string | null = null

					// 检查选区是否位于优先使用纯文本复制的元素内
					let currentElement =
						commonAncestor.nodeType === Node.ELEMENT_NODE
							? (commonAncestor as HTMLElement)
							: commonAncestor.parentElement
					let preferPlainTextCopy = false
					while (currentElement) {
						if (currentElement.tagName === "PRE" && currentElement.querySelector("code")) {
							preferPlainTextCopy = true
							break
						}
						// 检查计算后的 white-space 样式
						const computedStyle = window.getComputedStyle(currentElement)
						if (
							computedStyle.whiteSpace === "pre" ||
							computedStyle.whiteSpace === "pre-wrap" ||
							computedStyle.whiteSpace === "pre-line"
						) {
							// 如果元素本身或其祖先具有类似 pre 的 white-space 样式，
							// 且选区很可能包含在其中，则优先使用纯文本
							// 这有助于类似 TaskHeader 这类元素的文本显示
							preferPlainTextCopy = true
							break
						}

						// 如果到达已知的聊天消息边界或 body，则停止搜索
						if (
							currentElement.classList.contains("chat-row-assistant-message-container") ||
							currentElement.classList.contains("chat-row-user-message-container") ||
							currentElement.tagName === "BODY"
						) {
							break
						}
						currentElement = currentElement.parentElement
					}

					if (preferPlainTextCopy) {
						// 对于代码块或具有预格式化空白的元素，获取纯文本。
						textToCopy = selection.toString()
					} else {
						// 对于其他内容，使用现有的 HTML 转 Markdown 转换
						const clonedSelection = range.cloneContents()
						const div = document.createElement("div")
						div.appendChild(clonedSelection)
						const selectedHtml = div.innerHTML
						textToCopy = await convertHtmlToMarkdown(selectedHtml)
					}

					if (textToCopy !== null) {
						try {
							FileServiceClient.copyToClipboard(StringRequest.create({ value: textToCopy })).catch((err) => {
								console.error("Error copying to clipboard:", err)
							})
							e.preventDefault()
						} catch (error) {
							console.error("Error copying to clipboard:", error)
						}
					}
				}
			}
		}
		document.addEventListener("copy", handleCopy)

		return () => {
			document.removeEventListener("copy", handleCopy)
		}
	}, [])
	// 现在按钮状态由 useButtonState 钩子管理

	useEffect(() => {
		setExpandedRows({})
	}, [task?.ts])

	// handleFocusChange 已由 chatState 提供

	// Use message handlers hook
	const messageHandlers = useMessageHandlers(messages, chatState)

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, mode)
	}, [apiConfiguration, mode])

	const selectFilesAndImages = useCallback(async () => {
		try {
			const response = await FileServiceClient.selectFiles(
				BooleanRequest.create({
					value: selectedModelInfo.supportsImages,
				}),
			)
			if (
				response &&
				response.values1 &&
				response.values2 &&
				(response.values1.length > 0 || response.values2.length > 0)
			) {
				const currentTotal = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - currentTotal

				if (availableSlots > 0) {
					// Prioritize images first
					const imagesToAdd = Math.min(response.values1.length, availableSlots)
					if (imagesToAdd > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...response.values1.slice(0, imagesToAdd)])
					}

					// Use remaining slots for files
					const remainingSlots = availableSlots - imagesToAdd
					if (remainingSlots > 0) {
						setSelectedFiles((prevFiles) => [...prevFiles, ...response.values2.slice(0, remainingSlots)])
					}
				}
			}
		} catch (error) {
			console.error("Error selecting images & files:", error)
		}
	}, [selectedModelInfo.supportsImages])

	const shouldDisableFilesAndImages = selectedImages.length + selectedFiles.length >= MAX_IMAGES_AND_FILES_PER_MESSAGE

	// 监听本地 focusChatInput 事件
	useEffect(() => {
		const handleFocusChatInput = () => {
			if (isHidden) {
				navigateToChat()
			}
			textAreaRef.current?.focus()
		}

		window.addEventListener("focusChatInput", handleFocusChatInput)

		return () => {
			window.removeEventListener("focusChatInput", handleFocusChatInput)
		}
	}, [isHidden])

	// 设置 addToInput 订阅
	useEffect(() => {
		const clientId = (window as { clineClientId?: string }).clineClientId
		if (!clientId) {
			console.error("Client ID not found in window object for addToInput subscription")
			return
		}

		const request = StringRequest.create({ value: clientId })
		const cleanup = UiServiceClient.subscribeToAddToInput(request, {
			onResponse: (event) => {
				if (event.value) {
					setInputValue((prevValue) => {
						const newText = event.value
						const newTextWithNewline = newText + "\n"
						return prevValue ? `${prevValue}\n${newTextWithNewline}` : newTextWithNewline
					})
					// 在状态更新后添加滚动到底部
					// 自动聚焦输入并在新行开始光标，便于输入
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			onError: (error) => {
				console.error("Error in addToInput subscription:", error)
			},
			onComplete: () => {
				console.log("addToInput subscription completed")
			},
		})

		return cleanup
	}, [])

	useMount(() => {
		/* 注意：VSCode 窗口需要聚焦才能使此功能正常工作 */
		textAreaRef.current?.focus()
	})

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, sendingDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return filterVisibleMessages(modifiedMessages)
	}, [modifiedMessages])

	const lastProgressMessageText = useMemo(() => {
		// 首先检查扩展状态中是否有当前 focus chain 列表
		if (currentFocusChainChecklist) {
			return currentFocusChainChecklist
		}

		// 如果没有状态 focus chain 列表，则回退到最后的 task_progress 消息
		const lastProgressMessage = [...modifiedMessages].reverse().find((message) => message.say === "task_progress")
		return lastProgressMessage?.text
	}, [modifiedMessages, currentFocusChainChecklist])

	const groupedMessages = useMemo(() => {
		return groupMessages(visibleMessages)
	}, [visibleMessages])

	// 使用滚动行为钩子
	const scrollBehavior = useScrollBehavior(messages, visibleMessages, groupedMessages, expandedRows, setExpandedRows)

	const placeholderText = useMemo(() => {
		const text = task ? "Type a message..." : "Type your task here..."
		return text
	}, [task])

	// 添加返回CanView的处理函数
	const handleBackToCanView = () => {
		if (typeof window !== "undefined" && (window as any).vscode) {
			;(window as any).vscode.postMessage({
				type: "switchToCanView",
			})
		} else {
			// 如果不在VS Code环境中，使用标准的postMessage
			window.postMessage(
				{
					type: "switchToCanView",
				},
				"*",
			)
		}
	}

	const header = (
		<div className="flex items-center p-2 border-b border-gray-200 dark:border-gray-700" style={{ gridRow: "1" }}>
			<Button
				className="flex items-center"
				icon={<ArrowLeftOutlined />}
				onClick={handleBackToCanView}
				style={{
					color: "var(--vscode-textLink-foreground)",
				}}
				type="text">
				返回CAN工具集
			</Button>
		</div>
	)

	return (
		<ChatLayout header={header} isHidden={isHidden}>
			<div className="flex flex-col flex-1 overflow-hidden">
				{IS_STANDALONE && <Navbar />}
				{task ? (
					<TaskSection
						apiMetrics={apiMetrics}
						lastApiReqTotalTokens={lastApiReqTotalTokens}
						lastProgressMessageText={lastProgressMessageText}
						messageHandlers={messageHandlers}
						scrollBehavior={scrollBehavior}
						selectedModelInfo={{
							supportsPromptCache: selectedModelInfo.supportsPromptCache,
							supportsImages: selectedModelInfo.supportsImages || false,
						}}
						task={task}
					/>
				) : (
					<WelcomeSection
						hideAnnouncement={hideAnnouncement}
						shouldShowQuickWins={shouldShowQuickWins}
						showAnnouncement={showAnnouncement}
						showHistoryView={showHistoryView}
						taskHistory={taskHistory}
						telemetrySetting={telemetrySetting}
						version={version}
					/>
				)}
				{task && (
					<MessagesArea
						chatState={chatState}
						groupedMessages={groupedMessages}
						messageHandlers={messageHandlers}
						modifiedMessages={modifiedMessages}
						scrollBehavior={scrollBehavior}
						task={task}
					/>
				)}
			</div>
			<footer className="bg-[var(--vscode-sidebar-background)]" style={{ gridRow: "2" }}>
				<AutoApproveBar />
				<ActionButtons
					chatState={chatState}
					messageHandlers={messageHandlers}
					messages={messages}
					mode={mode}
					scrollBehavior={{
						scrollToBottomSmooth: scrollBehavior.scrollToBottomSmooth,
						disableAutoScrollRef: scrollBehavior.disableAutoScrollRef,
						showScrollToBottom: scrollBehavior.showScrollToBottom,
					}}
					task={task}
				/>
				<InputSection
					chatState={chatState}
					messageHandlers={messageHandlers}
					placeholderText={placeholderText}
					scrollBehavior={scrollBehavior}
					selectFilesAndImages={selectFilesAndImages}
					shouldDisableFilesAndImages={shouldDisableFilesAndImages}
				/>
			</footer>
		</ChatLayout>
	)
}

export default ChatView
