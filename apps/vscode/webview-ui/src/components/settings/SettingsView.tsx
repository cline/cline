import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { isClineInternalTester } from "@shared/internal/account"
import { ResetStateRequest } from "@shared/proto/cline/state"
import type { UserOrganization } from "@shared/proto/index.cline"
import {
	CheckCheck,
	FlaskConical,
	HardDriveDownload,
	Info,
	type LucideIcon,
	SlidersHorizontal,
	SquareTerminal,
	Wrench,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type ClineUser, useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import { isAdminOrOwner } from "../account/helpers"
import { Tab, TabContent, TabList, TabTrigger } from "../common/Tab"
import ViewHeader from "../common/ViewHeader"
import SectionHeader from "./SectionHeader"
import SettingsTargetHighlight from "./SettingsTargetHighlight"
import AboutSection from "./sections/AboutSection"
import ApiConfigurationSection from "./sections/ApiConfigurationSection"
import DebugSection from "./sections/DebugSection"
import FeatureSettingsSection from "./sections/FeatureSettingsSection"
import GeneralSettingsSection from "./sections/GeneralSettingsSection"
import { RemoteConfigSection } from "./sections/RemoteConfigSection"
import TerminalSettingsSection from "./sections/TerminalSettingsSection"
import { getNextSettingsNavigationRequestId, resolveSettingsTarget, type SettingsNavigationRequest } from "./settingsTargets"

const IS_DEV = process.env.IS_DEV

type SettingsTabID = "api-config" | "general" | "features" | "terminal" | "remote-config" | "about" | "debug"
interface SettingsTab {
	id: SettingsTabID
	name: string
	tooltipText: string
	headerText: string
	description: string
	icon: LucideIcon
	hidden?: (params?: { user: ClineUser | null; activeOrganization: UserOrganization | null }) => boolean
}

const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "API & Models",
		tooltipText: "Provider, API keys, model & context settings",
		headerText: "API & Models",
		description: "Configure your AI provider, model selection, and generation parameters.",
		icon: SlidersHorizontal,
	},
	{
		id: "general",
		name: "General & Layout",
		tooltipText: "Workspace layout, language & privacy",
		headerText: "General & Layout",
		description: "Manage workspace panes (Explorer & Editor), preferred language, and privacy.",
		icon: Wrench,
	},
	{
		id: "features",
		name: "Features",
		tooltipText: "Agent, editor & advanced features",
		headerText: "Features",
		description: "Control autonomous agent capabilities, checkpoints, compaction, and MCP display.",
		icon: CheckCheck,
	},
	{
		id: "terminal",
		name: "Terminal",
		tooltipText: "Terminal execution & shell integration",
		headerText: "Terminal",
		description: "Configure how Cline executes shell commands and interacts with your terminal.",
		icon: SquareTerminal,
	},
	{
		id: "remote-config",
		name: "Remote Config",
		tooltipText: "Remotely configured fields",
		headerText: "Remote Config",
		description: "Organization-managed remote configuration settings.",
		icon: HardDriveDownload,
		hidden: ({ activeOrganization } = { user: null, activeOrganization: null }) =>
			!activeOrganization || !isAdminOrOwner(activeOrganization),
	},
	{
		id: "about",
		name: "About",
		tooltipText: "Version & resources",
		headerText: "About",
		description: "Application version, documentation, and links.",
		icon: Info,
	},
	{
		id: "debug",
		name: "Debug",
		tooltipText: "Debug Tools",
		headerText: "Debug",
		description: "Developer diagnostic and state reset tools.",
		icon: FlaskConical,
		hidden: ({ user } = { user: null, activeOrganization: null }) => !IS_DEV && !isClineInternalTester(user?.email || ""),
	},
]

type SettingsViewProps = {
	onDone: () => void
	navigationRequest?: SettingsNavigationRequest
}

const renderSectionHeader = (tabId: string) => {
	const tab = SETTINGS_TABS.find((t) => t.id === tabId)
	if (!tab) {
		return null
	}

	return (
		<SectionHeader description={tab.description}>
			<div className="flex items-center gap-2.5">
				<tab.icon className="w-4 h-4 text-[#9aa0a8]" strokeWidth={1.8} />
				<span>{tab.headerText}</span>
			</div>
		</SectionHeader>
	)
}

const SettingsView = ({ navigationRequest, onDone }: SettingsViewProps) => {
	const initialTarget = resolveSettingsTarget(navigationRequest?.target)
	const TAB_CONTENT_MAP: Record<SettingsTabID, React.FC<any>> = useMemo(
		() => ({
			"api-config": ApiConfigurationSection,
			general: GeneralSettingsSection,
			features: FeatureSettingsSection,
			terminal: TerminalSettingsSection,
			"remote-config": RemoteConfigSection,
			about: AboutSection,
			debug: DebugSection,
		}),
		[],
	)

	const { version, extensionVariant, environment, settingsInitialModelTab } = useExtensionState()
	const { activeOrganization, clineUser } = useClineAuth()

	const [activeTab, setActiveTab] = useState<string>(initialTarget?.tabId || SETTINGS_TABS[0].id)
	const [pendingTarget, setPendingTarget] = useState<{ requestId: number; target: string } | undefined>(undefined)

	const selectSettingsTarget = useCallback((target: string, requestId: number) => {
		const resolved = resolveSettingsTarget(target)
		if (!resolved) {
			return
		}
		if (resolved.tabId) {
			setActiveTab(resolved.tabId)
		}
		setPendingTarget({ requestId, target })
	}, [])
	const completeSettingsTarget = useCallback((requestId: number) => {
		setPendingTarget((current) => (current?.requestId === requestId ? undefined : current))
	}, [])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type !== "grpc_response") {
				return
			}

			const grpcMessage = message.grpc_response?.message
			if (grpcMessage?.key !== "scrollToSettings") {
				return
			}

			const target = grpcMessage.value
			if (!target) {
				return
			}
			selectSettingsTarget(target, getNextSettingsNavigationRequestId())
		},
		[selectSettingsTarget],
	)

	useEvent("message", handleMessage)

	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	useEffect(() => {
		if (navigationRequest) {
			selectSettingsTarget(navigationRequest.target, navigationRequest.requestId)
		}
	}, [navigationRequest, selectSettingsTarget])

	const renderTabItem = useCallback(
		(tab: (typeof SETTINGS_TABS)[0]) => {
			const isActive = activeTab === tab.id
			return (
				<TabTrigger
					className="w-full text-left bg-transparent border-0 p-0"
					data-testid={`tab-${tab.id}`}
					key={tab.id}
					value={tab.id}>
					<Tooltip key={tab.id}>
						<TooltipTrigger asChild>
							<div
								className={cn(
									"w-full whitespace-nowrap overflow-hidden rounded-lg px-3 py-2 flex items-center gap-2.5 cursor-pointer text-[13px] transition-colors",
									isActive
										? "bg-white/[0.08] text-[#f2f4f7] font-medium"
										: "text-[#8c929b] hover:text-[#eceef0] hover:bg-white/[0.04]",
								)}>
								<tab.icon className="w-4 h-4 shrink-0" strokeWidth={isActive ? 2 : 1.75} />
								<span className="hidden sm:block truncate">{tab.name}</span>
							</div>
						</TooltipTrigger>
						<TooltipContent className="sm:hidden" side="right">
							{tab.tooltipText}
						</TooltipContent>
					</Tooltip>
				</TabTrigger>
			)
		},
		[activeTab],
	)

	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		const props: any = { renderSectionHeader }
		if (activeTab === "debug") {
			props.onResetState = handleResetState
		} else if (activeTab === "about") {
			props.version = version
			props.extensionVariant = extensionVariant
		} else if (activeTab === "api-config") {
			props.initialModelTab = settingsInitialModelTab
		}

		return <Component {...props} />
	}, [activeTab, handleResetState, settingsInitialModelTab, version, extensionVariant, TAB_CONTENT_MAP])

	return (
		<Tab className="bg-[#0e0f10]">
			<ViewHeader environment={environment} onDone={onDone} title="Settings" />

			<div className="flex flex-1 overflow-hidden -mt-3">
				<TabList
					className="shrink-0 w-14 sm:w-52 flex flex-col gap-1 overflow-y-auto bg-[#111214] border-r border-white/[0.07] p-2 sm:p-3 select-none"
					onValueChange={setActiveTab}
					value={activeTab}>
					<div className="hidden sm:block text-[10px] font-geist-mono uppercase tracking-[0.12em] text-[#5e646e] px-3 pt-1 pb-2">
						Preferences
					</div>
					{SETTINGS_TABS.filter((tab) => !tab.hidden?.({ user: clineUser, activeOrganization })).map(renderTabItem)}
				</TabList>

				<TabContent className="flex-1 overflow-y-auto bg-[#0e0f10]">
					<div className="w-full max-w-[740px] mx-auto px-5 sm:px-8 py-6">
						{ActiveContent}
					</div>
					{pendingTarget &&
						(() => {
							const resolved = resolveSettingsTarget(pendingTarget.target)
							return resolved?.elementId && (!resolved.tabId || resolved.tabId === activeTab) ? (
								<SettingsTargetHighlight
									key={pendingTarget.requestId}
									onComplete={completeSettingsTarget}
									requestId={pendingTarget.requestId}
									target={resolved}
								/>
							) : null
						})()}
				</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
