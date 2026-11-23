import { HistoryIcon, PanelLeftIcon, PlusIcon, PuzzleIcon, SettingsIcon, UserCircleIcon } from "lucide-react"
import { useMemo } from "react"
import ClineLogoVariable from "@/assets/ClineLogoVariable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useStudioWorkspacePanes } from "@/hooks/useStudioWorkspacePanes"
import { useExtensionState } from "../../context/ExtensionStateContext"

interface NavbarProps {
	startNewTask: (source: "navbar") => Promise<boolean>
}

export const Navbar = ({ startNewTask }: NavbarProps) => {
	const { navigateToHistory, navigateToSettings, navigateToAccount, navigateToMarketplace, navigateToChat } =
		useExtensionState()
	const { showExplorerAndEditor, setShowExplorerAndEditor } = useStudioWorkspacePanes()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "New Task",
				tooltip: "New Task",
				icon: PlusIcon,
				primary: true,
				navigate: async () => {
					try {
						if (await startNewTask("navbar")) {
							navigateToChat()
						}
					} catch (error) {
						console.error("Failed to clear task:", error)
					}
				},
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				primary: false,
				navigate: navigateToHistory,
			},
			{
				id: "customize",
				name: "Customize",
				tooltip: "MCP & Rules",
				icon: PuzzleIcon,
				primary: false,
				navigate: navigateToMarketplace,
			},
			{
				id: "account",
				name: "Account",
				tooltip: "Account",
				icon: UserCircleIcon,
				primary: false,
				navigate: navigateToAccount,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				primary: false,
				navigate: navigateToSettings,
			},
		],
		[navigateToAccount, navigateToChat, navigateToHistory, navigateToMarketplace, navigateToSettings, startNewTask],
	)

	return (
		<header
			className="flex-none w-full h-12 bg-[#0e0f10]/95 backdrop-blur-md border-b border-white/[0.07] px-5 flex items-center justify-between z-20 select-none"
			id="cline-navbar-container">
			<button
				aria-label="Cline Studio Home"
				className="flex items-center gap-2.5 bg-transparent border-0 p-0 cursor-pointer group"
				onClick={async () => {
					try {
						if (await startNewTask("navbar")) {
							navigateToChat()
						}
					} catch (error) {
						console.error("Failed to clear task:", error)
					}
				}}
				type="button">
				<span className="size-6 rounded-md bg-[#17181b] border border-white/[0.09] flex items-center justify-center group-hover:border-white/[0.18] transition-colors">
					<ClineLogoVariable className="size-3.5 text-[#eceef0]" />
				</span>
				<span className="text-[13.5px] font-medium tracking-[-0.015em] text-[#eceef0]">Cline</span>
				<span className="h-3.5 w-px bg-white/[0.1]" />
				<span className="text-[10.5px] font-geist-mono uppercase tracking-[0.12em] text-[#70767f]">Studio</span>
			</button>

			<nav className="inline-flex items-center gap-1">
				<Tooltip>
					<TooltipContent side="bottom">
						{showExplorerAndEditor
							? "Nascondi Explorer e File Editor (Solo Cline)"
							: "Mostra Explorer e File Editor"}
					</TooltipContent>
					<TooltipTrigger asChild>
						<button
							aria-label="Toggle Explorer and Editor"
							aria-pressed={showExplorerAndEditor}
							className={
								showExplorerAndEditor
									? "inline-flex items-center gap-1.5 h-7 px-2 mr-1 rounded-md bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[#d8dbe0] text-[12px] transition-colors cursor-pointer"
									: "inline-flex items-center gap-1.5 h-7 px-2 mr-1 rounded-md bg-transparent hover:bg-white/[0.06] border border-transparent text-[#6e747d] hover:text-[#eceef0] text-[12px] transition-colors cursor-pointer"
							}
							onClick={() => setShowExplorerAndEditor(!showExplorerAndEditor)}
							type="button">
							<PanelLeftIcon className="shrink-0" size={14} strokeWidth={1.75} />
							<span className="hidden lg:inline">{showExplorerAndEditor ? "Editor" : "Solo Cline"}</span>
						</button>
					</TooltipTrigger>
				</Tooltip>
				{SETTINGS_TABS.map((tab) => (
					<Tooltip key={`navbar-tooltip-${tab.id}`}>
						<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
						<TooltipTrigger asChild>
							<button
								aria-label={tab.tooltip}
								className={
									tab.primary
										? "inline-flex items-center gap-1.5 h-7 px-2.5 mr-1 rounded-md bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.09] text-[#eceef0] text-[12px] font-medium transition-colors cursor-pointer"
										: "inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-transparent hover:bg-white/[0.06] border border-transparent text-[#8f959e] hover:text-[#eceef0] text-[12px] font-normal transition-colors cursor-pointer"
								}
								data-testid={`tab-${tab.id}`}
								key={`navbar-button-${tab.id}`}
								onClick={() => tab.navigate()}
								type="button">
								<tab.icon className="shrink-0" size={14} strokeWidth={1.75} />
								<span className={tab.primary ? "hidden xs:inline" : "hidden md:inline"}>{tab.name}</span>
							</button>
						</TooltipTrigger>
					</Tooltip>
				))}
			</nav>
		</header>
	)
}
