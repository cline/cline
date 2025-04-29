import { useExtensionState } from "../context/ExtensionStateContext"
import { McpViewTab } from "@shared/mcp"

/**
 * Hook for navigating between different views in the application.
 */
export const useNavigator = () => {
	const { setShowMcp, setMcpTab } = useExtensionState()

	/**
	 * Navigate to the MCP view
	 * @param tab Optional tab to show in the MCP view
	 */
	const navigateToMcp = (tab?: McpViewTab) => {
		if (tab) {
			setMcpTab(tab)
		}
		setShowMcp(true)
	}

	return {
		navigateToMcp,
	}
}
