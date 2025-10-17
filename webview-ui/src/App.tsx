import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useEffect, useState } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import CanView from "./components/yaxon/CanView"
import MatrixParseView from "./components/yaxon/MatrixParseView"
import UdsDiagView from "./components/yaxon/UdsDiagView"
import { useClineAuth } from "./context/ClineAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
// 导入 Ant Design 组件示例
import AntdExample from "./examples/AntdExample"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		showHistory,
		showAccount,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideAnnouncement,
	} = useExtensionState()

	const [showCanView, setShowCanView] = useState(true) // 默认显示 CanView

	// 监听来自ChatView的返回CanView消息
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data || event.data?.data // 处理不同的消息格式

			
			if (message?.type === "switchToCanView") {
				setShowCanView(true)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const { clineUser, organizations, activeOrganization } = useClineAuth()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return <WelcomeView />
	}

	// Check if we're in a dedicated CAN tool tab
	const rootElement = document.getElementById("root")
	const canTool = rootElement?.getAttribute("data-can-tool")

	// If we're in a dedicated CAN tool tab, render only that tool
	// if (canTool === "matrix-parse") {
	// 	return <MatrixParseView />
	// } else if (canTool === "uds-diag") {
	// 	return <UdsDiagView />
	// }

	// 当其他视图显示时，隐藏CanView和ChatView
	const isOtherViewVisible = showSettings || showHistory || showMcp || showAccount

	// 只有当不在其他视图中且选择显示ChatView时才显示ChatView
	const shouldShowChatView = !showCanView && !isOtherViewVisible

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					clineUser={clineUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={!shouldShowChatView}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
			<CanView isHidden={isOtherViewVisible || !showCanView} onSwitchToChat={() => setShowCanView(false)} />

			{/* Ant Design 组件示例 - 仅用于测试 */}
			{/* <AntdExample /> */}
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
