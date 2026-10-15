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

// Tab definitions
type SettingsTabID = "api-config" | "features" | "terminal" | "general" | "about" | "debug" | "remote-config"
interface SettingsTab {
	id: SettingsTabID
	name: string
	tooltipText: string
	headerText: string
	icon: LucideIcon
	hidden?: (params?: { user: ClineUser | null; activeOrganization: UserOrganization | null }) => boolean
}

const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "API Configuration",
		tooltipText: "API Configuration",
		headerText: "API Configuration",
		icon: SlidersHorizontal,
	},
	{
		id: "features",
		name: "Features",
		tooltipText: "Feature Settings",
		headerText: "Feature Settings",
		icon: CheckCheck,
	},
	{
		id: "terminal",
		name: "Terminal",
		tooltipText: "Terminal Settings",
		headerText: "Terminal Settings",
		icon: SquareTerminal,
	},
	{
		id: "general",
		name: "General",
		tooltipText: "General Settings",
		headerText: "General Settings",
		icon: Wrench,
	},
	{
		id: "remote-config",
		name: "Remote Config",
		tooltipText: "Remotely configured fields",
		headerText: "Remote Config",
		icon: HardDriveDownload,
		hidden: ({ activeOrganization } = { user: null, activeOrganization: null }) =>
			!activeOrganization || !isAdminOrOwner(activeOrganization),
	},
	{
		id: "about",
		name: "About",
		tooltipText: "About Cline",
		headerText: "About",
		icon: Info,
	},
	// Only show in dev mode
	{
		id: "debug",
		name: "Debug",
		tooltipText: "Debug Tools",
		headerText: "Debug",
		icon: FlaskConical,
		hidden: ({ user } = { user: null, activeOrganization: null }) => !IS_DEV && !isClineInternalTester(user?.email || ""),
	},
]

type SettingsViewProps = {
	onDone: () => void
	navigationRequest?: SettingsNavigationRequest
}

// Helper to render section header - moved outside component for better performance
const renderSectionHeader = (tabId: string) => {
	const tab = SETTINGS_TABS.find((t) => t.id === tabId)
	if (!tab) {
		return null
	}

	return (
		<SectionHeader>
			<div className="flex items-center gap-2">
				<tab.icon className="w-4" />
				<div>{tab.headerText}</div>
			</div>
		</SectionHeader>
	)
}

const SettingsView = ({ navigationRequest, onDone }: SettingsViewProps) => {
	const initialTarget = resolveSettingsTarget(navigationRequest?.target)
	// Memoize to avoid recreation
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
	) // Empty deps - these imports never change

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

	// Optimized message handler with early returns
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

	// Memoized reset state handler
	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	// Update active tab and restart target emphasis for every navigation request.
	useEffect(() => {
		if (navigationRequest) {
			selectSettingsTarget(navigationRequest.target, navigationRequest.requestId)
		}
	}, [navigationRequest, selectSettingsTarget])

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
						<TooltipContent side="right">{tab.tooltipText}</TooltipContent>
					</Tooltip>
				</TabTrigger>
			)
		},
		[activeTab],
	)

	// Memoized active content component
	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		// Special props for specific components
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
		<Tab>
			<ViewHeader environment={environment} onDone={onDone} title="Settings" />

			<div className="flex flex-1 overflow-hidden">
				<TabList
					className="shrink-0 flex flex-col overflow-y-auto border-r border-sidebar-background"
					onValueChange={setActiveTab}
					value={activeTab}>
					{SETTINGS_TABS.filter((tab) => !tab.hidden?.({ user: clineUser, activeOrganization })).map(renderTabItem)}
				</TabList>

				<TabContent className="flex-1 overflow-auto">
					{ActiveContent}
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
