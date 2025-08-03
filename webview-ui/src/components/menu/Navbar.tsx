import { DatabaseIcon, HistoryIcon, PlusIcon, SettingsIcon, UserCircleIcon } from "lucide-react"
import { useMemo } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { TabTrigger } from "../common/Tab"

export const Navbar = () => {
	const { navigateToHistory, navigateToSettings, navigateToAccount, navigateToMcp, navigateToChat } = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "Chat",
				icon: PlusIcon,
				navigate: navigateToChat,
			},
			{
				id: "mcp",
				name: "MCP",
				icon: DatabaseIcon,
				navigate: navigateToMcp,
			},
			{
				id: "history",
				name: "History",
				icon: HistoryIcon,
				navigate: navigateToHistory,
			},
			{
				id: "account",
				name: "Account",
				icon: UserCircleIcon,
				navigate: navigateToAccount,
			},
			{
				id: "settings",
				name: "Settings",
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToAccount, navigateToChat, navigateToHistory, navigateToMcp, navigateToSettings],
	)

	return (
		<nav
			id="cline-navbar-container"
			className="flex-none inline-flex justify-end bg-transparent shadow-sm gap-2 mb-1 z-10 border-none items-center mr-4!">
			{SETTINGS_TABS.map((tab) => (
				<TabTrigger
					key={`navbar-trigger-${tab.id}`}
					value={tab.id}
					className="bg-transparent border-none text-white m-0 p-0 cursor-pointer"
					data-testid={`tab-${tab.id}`}
					onSelect={() => tab.navigate()}>
					<tab.icon className="text-white" strokeWidth={1} size={18} />
				</TabTrigger>
			))}
		</nav>
	)
}
