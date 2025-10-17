import {
	ArrowLeftOutlined,
	BugOutlined,
	CodeOutlined,
	DesktopOutlined,
	HistoryOutlined,
	PlusOutlined,
	SettingOutlined,
} from "@ant-design/icons"
import { EmptyRequest } from "@shared/proto/cline/common"
import { SystemInfo } from "@shared/proto/cline/models"
import type { MenuProps } from "antd"
import { Button, Menu } from "antd"
import { useEffect, useMemo, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"
import MatrixParseView from "./MatrixParseView"
import UdsDiagView from "./UdsDiagView"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { filterVisibleMessages, groupMessages, useChatState, useMessageHandlers, useScrollBehavior } from "../chat/chat-view"

interface CanViewProps {
	isHidden?: boolean
	onSwitchToChat?: () => void
}

const CanView: React.FC<CanViewProps> = ({ isHidden = false, onSwitchToChat }) => {
	const [systemInfo, setSystemInfo] = useState<SystemInfo | undefined>(undefined)
	const [activeTool, setActiveTool] = useState<string | null>(null)
	const { clineMessages: messages,navigateToChat, navigateToHistory, navigateToMcp, navigateToSettings } = useExtensionState()
	const task = useMemo(() => messages.at(0), [messages])
	
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	const visibleMessages = useMemo(() => {
			return filterVisibleMessages(modifiedMessages)
		}, [modifiedMessages])
	const groupedMessages = useMemo(() => {
		return groupMessages(visibleMessages)
	}, [visibleMessages])
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


	const scrollBehavior = useScrollBehavior(messages, visibleMessages, groupedMessages, expandedRows, setExpandedRows)
	// Use message handlers hook
	const messageHandlers = useMessageHandlers(messages, chatState)
	const fetchSystemInfo = async () => {
		try {
			const info = await ModelsServiceClient.getSystemInfo(EmptyRequest.create({}))
			setSystemInfo(info)
		} catch (err) {
			console.error("Failed to fetch system info:", err)
		}
	}

	useEffect(() => {
		fetchSystemInfo()

		return () => {}
	}, [])

	useEffect(() => {
			setExpandedRows({})
		}, [task?.ts])

	const onClick: MenuProps["onClick"] = (e) => {
		
		switch (e.key) {
			case "matrix-parse":
				// 在当前面板中显示矩阵报文解析组件
				setActiveTool("matrix-parse")
				break
			case "uds-diag":
				// 在当前面板中显示UDS诊断组件
				setActiveTool("uds-diag")
				break
			case "new-task":
				// 切换到ChatView
				if (onSwitchToChat) {
					onSwitchToChat()
				}
				navigateToChat()
				break
			case "history":
				navigateToHistory()
				break
			case "mcp":
				navigateToMcp()
				break
			case "config":
				navigateToSettings()
				break
			default:
				break
		}
	}

	// 处理返回主菜单的逻辑
	const handleBackToMenu = () => {
		setActiveTool(null)
	}
	const handleSwitchToChat = () => {
			
			if (onSwitchToChat) {
					onSwitchToChat()
				}
			navigateToChat()
	}


	// 如果已选择工具，则显示对应组件而不是菜单
	if (activeTool === "matrix-parse") {
		return <MatrixParseView
		 task={task} 
		 chatState={chatState}
		 modifiedMessages={modifiedMessages}	 
		 scrollBehavior={scrollBehavior}
		 messageHandlers={messageHandlers}
		 groupedMessages={groupedMessages}
		 onSwitchToChat={handleSwitchToChat}
		 onBack={handleBackToMenu} />
	}

	if (activeTool === "uds-diag") {
		return <UdsDiagView onBack={handleBackToMenu} />
	}

	const items: MenuProps["items"] = [
		{
			label: "CAN 开发助手",
			key: "can-dev",
			children: [
				{
					label: "矩阵报文解析",
					key: "matrix-parse",
					icon: <CodeOutlined />,
				},
				{
					label: "UDS诊断",
					key: "uds-diag",
					icon: <BugOutlined />,
				},
			],
		},
		{
			label: "Cline 操作",
			key: "cline-op",
			children: [
				{
					label: "当前任务",
					key: "new-task",
					icon: <PlusOutlined />,
				},
				{
					label: "历史对话",
					key: "history",
					icon: <HistoryOutlined />,
				},
				{
					label: "MCP 服务器",
					key: "mcp",
					icon: <DesktopOutlined />,
				},
				{
					label: "配置",
					key: "config",
					icon: <SettingOutlined />,
				},
			],
		},
	]

	// 如果隐藏则不渲染任何内容
	if (isHidden) {
		return null
	}

	return (
		<div style={{ display: "flex", height: "100%", flexDirection: "column" }}>
			<style>
				{`
            .ant-menu-item-selected {
              background-color: rgba(173, 216, 230, 0.3) !important;
            }
            .ant-menu-item-selected > .ant-menu-title-content,
            .ant-menu-item-selected > .ant-menu-item-icon,
            .ant-menu-item-selected > .anticon {
              color: #ffffff !important;
              font-weight: 500;
            }
            .ant-menu-item:active {
              background-color: rgba(173, 216, 230, 0.5) !important;
            }
            .ant-menu:not(.ant-menu-horizontal) .ant-menu-item-selected {
              background-color: rgba(173, 216, 230, 0.3) !important;
            }
            .ant-menu-item:hover {
              background-color: rgba(173, 216, 230, 0.2) !important;
              transition: background-color 0.3s;
            }
            .ant-menu-item:hover > .ant-menu-title-content,
            .ant-menu-item:hover > .ant-menu-item-icon,
            .ant-menu-item:hover > .anticon {
              color: #f0f0f0;
            }
            .ant-menu-submenu-title:hover {
              background-color: rgba(173, 216, 230, 0.2) !important;
              transition: background-color 0.3s;
            }
            .ant-menu-submenu-title:hover > .ant-menu-title-content,
            .ant-menu-submenu-title:hover > .ant-menu-item-icon,
            .ant-menu-submenu-title:hover > .anticon {
              color: #f0f0f0;
            }
            /* 父菜单在子菜单项被选中时的样式 */
            .ant-menu-submenu-active > .ant-menu-submenu-title > .ant-menu-title-content,
            .ant-menu-submenu-active > .ant-menu-submenu-title > .ant-menu-item-icon,
            .ant-menu-submenu-active > .ant-menu-submenu-title > .anticon,
            .ant-menu-submenu-open > .ant-menu-submenu-title > .ant-menu-title-content,
            .ant-menu-submenu-open > .ant-menu-submenu-title > .ant-menu-item-icon,
            .ant-menu-submenu-open > .ant-menu-submenu-title > .anticon {
              color: #ffffff !important;
              font-weight: 500;
            }
            /* 父菜单在子菜单项被选中时的悬停样式 */
            .ant-menu-submenu-active > .ant-menu-submenu-title:hover > .ant-menu-title-content,
            .ant-menu-submenu-active > .ant-menu-submenu-title:hover > .ant-menu-item-icon,
            .ant-menu-submenu-active > .ant-menu-submenu-title:hover > .anticon,
            .ant-menu-submenu-open > .ant-menu-submenu-title:hover > .ant-menu-title-content,
            .ant-menu-submenu-open > .ant-menu-submenu-title:hover > .ant-menu-item-icon,
            .ant-menu-submenu-open > .ant-menu-submenu-title:hover > .anticon {
              color: #f0f0f0 !important;
            }
          `}
			</style>
			<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
				<h2 className="text-lg font-semibold mb-4 p-4">CAN 工具集</h2>
				<Menu
					defaultOpenKeys={["can-dev", "cline-op"]}
					items={items}
					mode="inline"
					onClick={onClick}
					style={{ flex: 1, minWidth: 0 }}
				/>
			</div>
		</div>
	)
}

export default CanView
