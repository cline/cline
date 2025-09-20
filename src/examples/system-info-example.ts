/**
 * 示例：如何在 WebView 中调用 getSystemInfo 接口
 *
 * 这个示例展示了如何通过 gRPC 客户端调用我们在 ModelsService 中添加的新方法。
 */

// 在 WebView 端的调用示例
async function callSystemInfoFromWebview() {
	try {
		// 导入 gRPC 客户端（使用相对于 webview-ui 的路径）
		const { ModelsServiceClient } = await import("../../webview-ui/src/services/grpc-client")
		const { EmptyRequest } = await import("@shared/proto/cline/common")

		// 调用新接口
		const systemInfo = await ModelsServiceClient.getSystemInfo(EmptyRequest.create({}))

		// 处理返回的结果
		console.log("System Information:")
		console.log("- Platform:", systemInfo.platform)
		console.log("- Architecture:", systemInfo.arch)
		console.log("- CPU Count:", systemInfo.cpuCount)
		console.log("- Total Memory:", systemInfo.totalMemory)
		console.log("- Free Memory:", systemInfo.freeMemory)
		console.log("- Hostname:", systemInfo.hostname)
		console.log("- Uptime:", systemInfo.uptime)

		// 在实际应用中，你可能会将这些信息显示在 UI 上
		// 例如：更新 React 组件的状态
		// setSystemInfo(systemInfo)

		return systemInfo
	} catch (error) {
		console.error("Failed to get system information:", error)
		throw error
	}
}

// 在 Controller 端的直接调用示例
async function callSystemInfoFromController(controller: any) {
	try {
		// 导入处理器函数
		const { getSystemInfo } = await import("@core/controller/models/getSystemInfo")
		const { EmptyRequest } = await import("@shared/proto/cline/common")

		// 直接调用处理器函数
		const systemInfo = await getSystemInfo(controller, EmptyRequest.create({}))

		// 处理返回的结果
		console.log("System Information from Controller:")
		console.log("- Platform:", systemInfo.platform)
		console.log("- Architecture:", systemInfo.arch)
		console.log("- CPU Count:", systemInfo.cpuCount)

		return systemInfo
	} catch (error) {
		console.error("Failed to get system information from controller:", error)
		throw error
	}
}

// React 组件中的使用示例
function SystemInfoComponent() {
	// 假设这是在 React 组件中的使用方式
	// const { state } = useExtensionState() // 获取全局状态
	// const [systemInfo, setSystemInfo] = useState(null)
	// const [loading, setLoading] = useState(false)

	const fetchSystemInfo = async () => {
		// setLoading(true)
		try {
			const info = await callSystemInfoFromWebview()
			// setSystemInfo(info)
			// 可以在这里更新组件状态或执行其他操作
		} catch (error) {
			console.error("Error fetching system info:", error)
			// 可以设置错误状态并显示给用户
		} finally {
			// setLoading(false)
		}
	}

	return {
		fetchSystemInfo,
		// systemInfo,
		// loading
	}
}

// 导出示例函数
export { callSystemInfoFromWebview, callSystemInfoFromController, SystemInfoComponent }

// 默认导出
export default {
	callSystemInfoFromWebview,
	callSystemInfoFromController,
	SystemInfoComponent,
}
