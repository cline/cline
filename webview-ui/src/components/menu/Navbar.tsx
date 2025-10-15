import { TooltipContent } from "@radix-ui/react-tooltip"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { HistoryIcon, PlusIcon, SettingsIcon, UserCircleIcon } from "lucide-react"
import { useMemo } from "react"
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"

// Custom MCP Server Icon component using VSCode codicon
const McpServerIcon = ({ className, size }: { className?: string; size?: number }) => (
	<span
		className={`codicon codicon-server flex items-center ${className || ""}`}
		style={{ fontSize: size ? `${size}px` : "12.5px", marginBottom: "1px" }}
	/>
)

export const Navbar = () => {
	const { navigateToHistory, navigateToSettings, navigateToAccount, navigateToMcp, navigateToChat } = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "Chat",
				tooltip: "New Task",
				icon: PlusIcon,
				navigate: () => {
					// Close the current task, then navigate to the chat view
					TaskServiceClient.clearTask({})
						.catch((error) => {
							console.error("Failed to clear task:", error)
						})
						.finally(() => navigateToChat())
				},
			},
			{
				id: "mcp",
				name: "MCP",
				tooltip: "MCP Servers",
				icon: McpServerIcon,
				navigate: navigateToMcp,
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				navigate: navigateToHistory,
			},
			{
				id: "account",
				name: "Account",
				tooltip: "Account",
				icon: UserCircleIcon,
				navigate: navigateToAccount,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToAccount, navigateToChat, navigateToHistory, navigateToMcp, navigateToSettings],
	)

	return (
		<nav
			className="flex-none inline-flex justify-end bg-transparent gap-1 mb-1 z-10 border-none items-center mr-4!"
			id="cline-navbar-container">
			{SETTINGS_TABS.map((tab) => (
				<Tooltip key={`navbar-tooltip-${tab.id}`}>
					<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
					<TooltipTrigger asChild>
						<VSCodeButton
							appearance="icon"
							aria-label={tab.tooltip}
							data-testid={`tab-${tab.id}`}
							key={`navbar-button-${tab.id}`}
							onClick={() => tab.navigate()}
							style={{ padding: "0px", height: "20px" }}>
							<div className="flex items-center gap-1 text-xs whitespace-nowrap min-w-0 w-full">
								<tab.icon className="text-(--vscode-foreground)" size={18} strokeWidth={1} />
							</div>
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			))}
		</nav>
	)
}
