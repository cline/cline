import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeTextArea,
} from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState, useRef } from "react"
import {
	Settings,
	Webhook,
	CheckCheck,
	SquareMousePointer,
	GitBranch,
	Bell,
	Database,
	SquareTerminal,
	FlaskConical,
	Globe,
	Info,
	LucideIcon,
} from "lucide-react"
import HeroTooltip from "@/components/common/HeroTooltip"
import SectionHeader from "./SectionHeader"
import Section from "./Section"
import PreferredLanguageSetting from "./PreferredLanguageSetting" // Added import
import { OpenAIReasoningEffort } from "@shared/ChatSettings"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import SettingsButton from "@/components/common/SettingsButton"
import ApiOptions from "./ApiOptions"
import { TabButton } from "../mcp/configuration/McpConfigurationView"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { StateServiceClient } from "@/services/grpc-client"
import FeatureSettingsSection from "./FeatureSettingsSection"
import BrowserSettingsSection from "./BrowserSettingsSection"
import TerminalSettingsSection from "./TerminalSettingsSection"
import { FEATURE_FLAGS } from "@shared/services/feature-flags/feature-flags"
import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import { cn } from "@/utils/cn"
const { IS_DEV } = process.env

// Styles for the tab system
const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden"
const settingsTabList =
	"w-48 data-[compact=true]:w-12 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-[var(--vscode-sideBar-background)]"
const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center border-l-2 border-transparent text-[var(--vscode-foreground)] opacity-70 hover:bg-[var(--vscode-list-hoverBackground)] data-[compact=true]:w-12 data-[compact=true]:p-4"
const settingsTabTriggerActive =
	"opacity-100 border-l-2 border-l-[var(--vscode-focusBorder)] border-t-0 border-r-0 border-b-0 bg-[var(--vscode-list-activeSelectionBackground)]"

// Tab definitions
interface SettingsTab {
	id: string
	name: string
	tooltipText: string
	headerText: string
	icon: LucideIcon
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "API Configuration",
		tooltipText: "API Configuration",
		headerText: "API Configuration",
		icon: Webhook,
	},
]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	const {
		apiConfiguration,
		version,
		customInstructions,
		setCustomInstructions,
		openRouterModels,
		telemetrySetting,
		setTelemetrySetting,
		chatSettings,
		setChatSettings,
		planActSeparateModelsSetting,
		setPlanActSeparateModelsSetting,
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
	} = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const [pendingTabChange, setPendingTabChange] = useState<"plan" | "act" | null>(null)

	const handleSubmit = (withoutDone: boolean = false) => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		// setApiErrorMessage(apiValidationResult)
		// setModelIdErrorMessage(modelIdValidationResult)

		let apiConfigurationToSubmit = apiConfiguration
		if (!apiValidationResult && !modelIdValidationResult) {
			// vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			// vscode.postMessage({
			// 	type: "customInstructions",
			// 	text: customInstructions,
			// })
			// vscode.postMessage({
			// 	type: "telemetrySetting",
			// 	text: telemetrySetting,
			// })
			// console.log("handleSubmit", withoutDone)
			// vscode.postMessage({
			// 	type: "separateModeSetting",
			// 	text: separateModeSetting,
			// })
		} else {
			// if the api configuration is invalid, we don't save it
			apiConfigurationToSubmit = undefined
		}

		vscode.postMessage({
			type: "updateSettings",
			planActSeparateModelsSetting,
			customInstructionsSetting: customInstructions,
			telemetrySetting,
			enableCheckpointsSetting,
			mcpMarketplaceEnabled,
			apiConfiguration: apiConfigurationToSubmit,
		})

		if (!withoutDone) {
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. 
	so trying to use useEffect with a dependency array of only one value for example will use any 
	other variables' old values. In most cases you don't want this, and should opt to use react-use 
	hooks.
    
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])
	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "didUpdateSettings":
					if (pendingTabChange) {
						vscode.postMessage({
							type: "togglePlanActMode",
							chatSettings: {
								mode: pendingTabChange,
								preferredLanguage: chatSettings.preferredLanguage,
								openAIReasoningEffort: chatSettings.openAIReasoningEffort,
							},
						})
						setPendingTabChange(null)
					}
					break
				// We'll implement tab navigation later
				// case "openSettingsTab":
				// 	if (message.text) {
				// 		setActiveTab(message.text)
				// 	}
				// 	break
				case "grpc_response":
					if (message.grpc_response?.message?.action === "scrollToSettings") {
						setTimeout(() => {
							const elementId = message.grpc_response?.message?.value
							if (elementId) {
								const element = document.getElementById(elementId)
								if (element) {
									element.scrollIntoView({ behavior: "smooth" })

									element.style.transition = "background-color 0.5s ease"
									element.style.backgroundColor = "var(--vscode-textPreformat-background)"

									setTimeout(() => {
										element.style.backgroundColor = "transparent"
									}, 1200)
								}
							}
						}, 300)
					}
					break
			}
		},
		[pendingTabChange],
	)

	useEvent("message", handleMessage)

	const handleResetState = async () => {
		try {
			await StateServiceClient.resetState({})
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}

	const handleTabChange = (tab: "plan" | "act") => {
		if (tab === chatSettings.mode) {
			return
		}
		setPendingTabChange(tab)
		handleSubmit(true)
	}

	// Track active tab
	const [activeTab, setActiveTab] = useState<string>(targetSection || SETTINGS_TABS[0].id)

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection) {
			setActiveTab(targetSection)
		}
	}, [targetSection])

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-[var(--vscode-foreground)] m-0">Settings</h3>
				</div>
				<div className="flex gap-2">
					<VSCodeButton onClick={() => handleSubmit(false)}>Save</VSCodeButton>
				</div>
			</TabHeader>

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={(value) => setActiveTab(value)}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}>
					{SETTINGS_TABS.map((tab) =>
						isCompactMode ? (
							<HeroTooltip key={tab.id} content={tab.tooltipText} placement="right">
								<TabTrigger
									value={tab.id}
									className={cn(
										activeTab === tab.id
											? `${settingsTabTrigger} ${settingsTabTriggerActive}`
											: settingsTabTrigger,
										"focus:ring-0",
									)}
									data-compact={isCompactMode}
									data-testid={`tab-${tab.id}`}>
									<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
										<tab.icon className="w-4 h-4" />
										<span className="tab-label">{tab.name}</span>
									</div>
								</TabTrigger>
							</HeroTooltip>
						) : (
							<TabTrigger
								key={tab.id}
								value={tab.id}
								className={cn(
									activeTab === tab.id
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"focus:ring-0",
								)}
								data-compact={isCompactMode}
								data-testid={`tab-${tab.id}`}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<tab.icon className="w-4 h-4" />
									<span className="tab-label">{tab.name}</span>
								</div>
							</TabTrigger>
						),
					)}
				</TabList>

				{/* Content area */}
				<TabContent className="flex-1 overflow-auto">
					{activeTab === SETTINGS_TABS[0].id && (
						<div>
							<SectionHeader>
								<div className="flex items-center gap-2">
									{(() => {
										const Icon = SETTINGS_TABS[0].icon
										return <Icon className="w-4" />
									})()}
									<div>{SETTINGS_TABS[0].headerText}</div>
								</div>
							</SectionHeader>

							<Section>
								{/* Tabs container */}
								{planActSeparateModelsSetting ? (
									<div className="border border-solid border-[var(--vscode-panel-border)] rounded-md p-[10px] mb-5 bg-[var(--vscode-panel-background)]">
										<div className="flex gap-[1px] mb-[10px] -mt-2 border-0 border-b border-solid border-[var(--vscode-panel-border)]">
											<TabButton
												isActive={chatSettings.mode === "plan"}
												onClick={() => handleTabChange("plan")}>
												Plan Mode
											</TabButton>
											<TabButton
												isActive={chatSettings.mode === "act"}
												onClick={() => handleTabChange("act")}>
												Act Mode
											</TabButton>
										</div>

										{/* Content container */}
										<div className="-mb-3">
											<ApiOptions
												key={chatSettings.mode}
												showModelOptions={true}
												apiErrorMessage={apiErrorMessage}
												modelIdErrorMessage={modelIdErrorMessage}
											/>
										</div>
									</div>
								) : (
									<ApiOptions
										key={"single"}
										showModelOptions={true}
										apiErrorMessage={apiErrorMessage}
										modelIdErrorMessage={modelIdErrorMessage}
									/>
								)}
							</Section>

							<SectionHeader>
								<div className="flex items-center gap-2">
									<Settings className="w-4" />
									<div>General Settings</div>
								</div>
							</SectionHeader>

							<Section>
								<div className="mb-[5px]">
									<VSCodeTextArea
										value={customInstructions ?? ""}
										className="w-full"
										resize="vertical"
										rows={4}
										placeholder={
											'e.g. "Run unit tests at the end", "Use TypeScript with async/await", "Speak in Spanish"'
										}
										onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
										<span className="font-medium">Custom Instructions</span>
									</VSCodeTextArea>
									<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
										These instructions are added to the end of the system prompt sent with every request.
									</p>
								</div>

								{chatSettings && (
									<PreferredLanguageSetting chatSettings={chatSettings} setChatSettings={setChatSettings} />
								)}

								<div className="mb-[5px]">
									<VSCodeCheckbox
										className="mb-[5px]"
										checked={planActSeparateModelsSetting}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											setPlanActSeparateModelsSetting(checked)
										}}>
										Use different models for Plan and Act modes
									</VSCodeCheckbox>
									<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
										Switching between Plan and Act mode will persist the API and model used in the previous
										mode. This may be helpful e.g. when using a strong reasoning model to architect a plan for
										a cheaper coding model to act on.
									</p>
								</div>

								<div className="mb-[5px]">
									<VSCodeCheckbox
										className="mb-[5px]"
										checked={telemetrySetting === "enabled"}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											setTelemetrySetting(checked ? "enabled" : "disabled")
										}}>
										Allow anonymous error and usage reporting
									</VSCodeCheckbox>
									<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
										Help improve Cline by sending anonymous usage data and error reports. No code, prompts, or
										personal information are ever sent. See our{" "}
										<VSCodeLink href="https://docs.cline.bot/more-info/telemetry" className="text-inherit">
											telemetry overview
										</VSCodeLink>{" "}
										and{" "}
										<VSCodeLink href="https://cline.bot/privacy" className="text-inherit">
											privacy policy
										</VSCodeLink>{" "}
										for more details.
									</p>
								</div>
							</Section>

							{/* Feature Settings Section */}
							<SectionHeader>
								<div className="flex items-center gap-2">
									<CheckCheck className="w-4" />
									<div>Feature Settings</div>
								</div>
							</SectionHeader>
							<Section>
								<FeatureSettingsSection />
							</Section>

							{/* Browser Settings Section */}
							<SectionHeader>
								<div className="flex items-center gap-2">
									<SquareMousePointer className="w-4" />
									<div>Browser Settings</div>
								</div>
							</SectionHeader>
							<Section>
								<BrowserSettingsSection />
							</Section>

							{/* Terminal Settings Section */}
							<SectionHeader>
								<div className="flex items-center gap-2">
									<SquareTerminal className="w-4" />
									<div>Terminal Settings</div>
								</div>
							</SectionHeader>
							<Section>
								<TerminalSettingsSection />
							</Section>

							{IS_DEV && (
								<>
									<SectionHeader>
										<div className="flex items-center gap-2">
											<FlaskConical className="w-4" />
											<div>Debug</div>
										</div>
									</SectionHeader>
									<Section>
										<VSCodeButton
											onClick={handleResetState}
											className="mt-[5px] w-auto"
											style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
											Reset State
										</VSCodeButton>
										<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
											This will reset all global state and secret storage in the extension.
										</p>
									</Section>
								</>
							)}

							<SectionHeader>
								<div className="flex items-center gap-2">
									<Info className="w-4" />
									<div>About</div>
								</div>
							</SectionHeader>
							<Section>
								<div className="text-center text-[var(--vscode-descriptionForeground)] text-xs leading-[1.2] px-0 py-0 pr-2 pb-[15px] mt-auto">
									<p className="break-words m-0 p-0">
										If you have any questions or feedback, feel free to open an issue at{" "}
										<VSCodeLink href="https://github.com/cline/cline" className="inline">
											https://github.com/cline/cline
										</VSCodeLink>
									</p>
									<p className="italic mt-[10px] mb-0 p-0">v{version}</p>
								</div>
							</Section>
						</div>
					)}
				</TabContent>
			</div>
		</Tab>
	)
}

export default memo(SettingsView)
