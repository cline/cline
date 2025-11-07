import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { ResetStateRequest } from "@shared/proto/cline/state"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import {
	CheckCheck,
	FlaskConical,
	Info,
	type LucideIcon,
	SlidersHorizontal,
	SquareMousePointer,
	SquareTerminal,
	Wrench,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useEvent } from "react-use"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import SectionHeader from "./SectionHeader"
import AboutSection from "./sections/AboutSection"
import ApiConfigurationSection from "./sections/ApiConfigurationSection"
import BrowserSettingsSection from "./sections/BrowserSettingsSection"
import DebugSection from "./sections/DebugSection"
import FeatureSettingsSection from "./sections/FeatureSettingsSection"
import GeneralSettingsSection from "./sections/GeneralSettingsSection"
import TerminalSettingsSection from "./sections/TerminalSettingsSection"

const IS_DEV = process.env.IS_DEV

// Tab definitions
interface SettingsTab {
	id: string
	name: string
	tooltipText: string
	headerText: string
	icon: LucideIcon
	hidden?: boolean
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "settings.tabs.api_config",
		tooltipText: "settings.tooltips.api_config",
		headerText: "settings.headers.api_config",
		icon: SlidersHorizontal,
	},
	{
		id: "features",
		name: "settings.tabs.features",
		tooltipText: "settings.tooltips.features",
		headerText: "settings.headers.features",
		icon: CheckCheck,
	},
	{
		id: "browser",
		name: "settings.tabs.browser",
		tooltipText: "settings.tooltips.browser",
		headerText: "settings.headers.browser",
		icon: SquareMousePointer,
	},
	{
		id: "terminal",
		name: "settings.tabs.terminal",
		tooltipText: "settings.tooltips.terminal",
		headerText: "settings.headers.terminal",
		icon: SquareTerminal,
	},
	{
		id: "general",
		name: "settings.tabs.general",
		tooltipText: "settings.tooltips.general",
		headerText: "settings.headers.general",
		icon: Wrench,
	},
	{
		id: "about",
		name: "settings.tabs.about",
		tooltipText: "settings.tooltips.about",
		headerText: "settings.headers.about",
		icon: Info,
	},
	// Only show in dev mode
	{
		id: "debug",
		name: "Debug",
		tooltipText: "Debug Tools",
		headerText: "Debug",
		icon: FlaskConical,
		hidden: !IS_DEV,
	},
]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

// Helper to render section header - moved outside component for better performance
const renderSectionHeader = (tabId: string, t: (key: string) => string) => {
	const tab = SETTINGS_TABS.find((t) => t.id === tabId)
	if (!tab) {
		return null
	}

	return (
		<SectionHeader>
			<div className="flex items-center gap-2">
				<tab.icon className="w-4" />
				<div>{t(tab.headerText)}</div>
			</div>
		</SectionHeader>
	)
}

const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	// Memoize to avoid recreation
	const TAB_CONTENT_MAP = useMemo(
		() => ({
			"api-config": ApiConfigurationSection,
			general: GeneralSettingsSection,
			features: FeatureSettingsSection,
			browser: BrowserSettingsSection,
			terminal: TerminalSettingsSection,
			about: AboutSection,
			debug: DebugSection,
		}),
		[],
	) // Empty deps - these imports never change

	const { version, environment } = useExtensionState()
	const { t } = useTranslation("common")

	const [activeTab, setActiveTab] = useState<string>(targetSection || SETTINGS_TABS[0].id)

	// Optimized message handler with early returns
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type !== "grpc_response") {
			return
		}

		const grpcMessage = message.grpc_response?.message
		if (grpcMessage?.key !== "scrollToSettings") {
			return
		}

		const tabId = grpcMessage.value
		if (!tabId) {
			return
		}

		// Check if valid tab ID
		if (SETTINGS_TABS.some((tab) => tab.id === tabId)) {
			setActiveTab(tabId)
			return
		}

		// Fallback to element scrolling
		requestAnimationFrame(() => {
			const element = document.getElementById(tabId)
			if (!element) {
				return
			}

			element.scrollIntoView({ behavior: "smooth" })
			element.style.transition = "background-color 0.5s ease"
			element.style.backgroundColor = "var(--vscode-textPreformat-background)"

			setTimeout(() => {
				element.style.backgroundColor = "transparent"
			}, 1200)
		})
	}, [])

	useEvent("message", handleMessage)

	// Memoized reset state handler
	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection) {
			setActiveTab(targetSection)
		}
	}, [targetSection])

	// Memoized tab item renderer
	const renderTabItem = useCallback(
		(tab: (typeof SETTINGS_TABS)[0]) => {
			return (
				<TabTrigger className="flex justify-baseline" data-testid={`tab-${tab.id}`} key={tab.id} value={tab.id}>
					<Tooltip key={tab.id}>
						<TooltipTrigger>
							<div
								className={cn(
									"whitespace-nowrap overflow-hidden h-12 sm:py-3 box-border flex items-center border-l-2 border-transparent text-foreground opacity-70 bg-transparent hover:bg-list-hover p-4 cursor-pointer gap-2",
									{
										"opacity-100 border-l-2 border-l-foreground border-t-0 border-r-0 border-b-0 bg-selection":
											activeTab === tab.id,
									},
								)}>
								<tab.icon className="w-4 h-4" />
								<span className="hidden sm:block">{tab.name}</span>
							</div>
						</TooltipTrigger>
						<TooltipContent side="right">{t(tab.tooltipText)}</TooltipContent>
					</Tooltip>
				</TabTrigger>
			)
		},
		[activeTab, isCompactMode, handleTabChange, t],
	)

	// Memoized active content component
	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		// Special props for specific components
		const props: any = {
			renderSectionHeader: (tabId: string) => renderSectionHeader(tabId, t),
		}
		if (activeTab === "debug") {
			props.onResetState = handleResetState
		} else if (activeTab === "about") {
			props.version = version
		}

		return <Component {...props} />
	}, [activeTab, handleResetState, version, t])

	const titleColor = getEnvironmentColor(environment)

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-md m-0" style={{ color: titleColor }}>
						{t("settings.title")}
					</h3>
				</div>
				<div className="flex gap-2">
					<VSCodeButton onClick={onDone}>{t("settings.done_button")}</VSCodeButton>
				</div>
			</TabHeader>

			<div className="flex flex-1 overflow-hidden">
				<TabList
					className="shrink-0 flex flex-col overflow-y-auto border-r border-sidebar-background"
					onValueChange={setActiveTab}
					value={activeTab}>
					{SETTINGS_TABS.filter((tab) => !tab.hidden).map(renderTabItem)}
				</TabList>

				<TabContent className="flex-1 overflow-auto">{ActiveContent}</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
