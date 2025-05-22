import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import { isEqual } from "lodash-es" // Added for deep comparison
import PreferredLanguageSetting from "./PreferredLanguageSetting" // Added import
import { ChatSettings, OpenAIReasoningEffort } from "@shared/ChatSettings"
import { ApiConfiguration } from "@shared/api" // Corrected import for ApiConfiguration
import { TelemetrySetting } from "@shared/TelemetrySetting" // Added import
import { useExtensionStore } from "@/store/extensionStore" // Changed import
import { validateApiConfiguration, validateModelId } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import ApiOptions from "./ApiOptions"
import { TabButton } from "../mcp/configuration/McpConfigurationView"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { StateServiceClient } from "@/services/grpc-client"
import FeatureSettingsSection from "./FeatureSettingsSection"
import BrowserSettingsSection from "./BrowserSettingsSection"
import TerminalSettingsSection from "./TerminalSettingsSection"
import { FEATURE_FLAGS } from "@shared/services/feature-flags/feature-flags"
const { IS_DEV } = process.env

type SettingsViewProps = {
	onDone: () => void
}

type InitialSettings = {
	apiConfiguration: ApiConfiguration | undefined
	customInstructions: string | null | undefined
	telemetrySetting: TelemetrySetting
	chatSettings: ChatSettings
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting: boolean | undefined
	mcpMarketplaceEnabled: boolean | undefined
} | null

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const apiConfiguration = useExtensionStore((state) => state.apiConfiguration)
	const version = useExtensionStore((state) => state.version)
	const customInstructions = useExtensionStore((state) => state.customInstructions)
	const setCustomInstructions = useExtensionStore((state) => state.setCustomInstructions)
	const openRouterModels = useExtensionStore((state) => state.openRouterModels)
	const telemetrySetting = useExtensionStore((state) => state.telemetrySetting)
	const setTelemetrySetting = useExtensionStore((state) => state.setTelemetrySetting)
	const chatSettings = useExtensionStore((state) => state.chatSettings)
	const setChatSettings = useExtensionStore((state) => state.setChatSettings)
	const planActSeparateModelsSetting = useExtensionStore((state) => state.planActSeparateModelsSetting)
	const setPlanActSeparateModelsSetting = useExtensionStore((state) => state.setPlanActSeparateModelsSetting)
	const enableCheckpointsSetting = useExtensionStore((state) => state.enableCheckpointsSetting)
	const mcpMarketplaceEnabled = useExtensionStore((state) => state.mcpMarketplaceEnabled)

	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const [pendingTabChange, setPendingTabChange] = useState<"plan" | "act" | null>(null)
	const [initialSettings, setInitialSettings] = useState<InitialSettings>(null)
	const [hasChanges, setHasChanges] = useState(false)

	// Capture initial settings on mount
	useEffect(() => {
		setInitialSettings({
			apiConfiguration,
			customInstructions,
			telemetrySetting,
			chatSettings,
			planActSeparateModelsSetting,
			enableCheckpointsSetting,
			mcpMarketplaceEnabled,
		})
	}, []) // Deliberately empty to run only once on mount

	// Detect changes compared to initial settings
	useEffect(() => {
		if (initialSettings) {
			const currentSettingsMatchInitial =
				isEqual(apiConfiguration, initialSettings.apiConfiguration) &&
				customInstructions === initialSettings.customInstructions &&
				telemetrySetting === initialSettings.telemetrySetting &&
				isEqual(chatSettings, initialSettings.chatSettings) &&
				planActSeparateModelsSetting === initialSettings.planActSeparateModelsSetting &&
				enableCheckpointsSetting === initialSettings.enableCheckpointsSetting &&
				mcpMarketplaceEnabled === initialSettings.mcpMarketplaceEnabled

			setHasChanges(!currentSettingsMatchInitial)
		}
	}, [
		apiConfiguration,
		customInstructions,
		telemetrySetting,
		chatSettings,
		planActSeparateModelsSetting,
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		initialSettings,
	])

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

		if (hasChanges) {
			const payload: {
				type: "updateSettings"
				planActSeparateModelsSetting?: boolean
				customInstructionsSetting?: string | undefined
				telemetrySetting?: TelemetrySetting | undefined
				enableCheckpointsSetting?: boolean | undefined
				mcpMarketplaceEnabled?: boolean | undefined
				apiConfiguration?: ApiConfiguration | undefined
			} = { type: "updateSettings" }

			if (initialSettings) {
				if (planActSeparateModelsSetting !== initialSettings.planActSeparateModelsSetting) {
					payload.planActSeparateModelsSetting = planActSeparateModelsSetting
				}
				if (customInstructions !== initialSettings.customInstructions) {
					payload.customInstructionsSetting = customInstructions === null ? undefined : customInstructions
				}
				if (telemetrySetting !== initialSettings.telemetrySetting) {
					payload.telemetrySetting = telemetrySetting
				}
				if (enableCheckpointsSetting !== initialSettings.enableCheckpointsSetting) {
					payload.enableCheckpointsSetting = enableCheckpointsSetting
				}
				if (mcpMarketplaceEnabled !== initialSettings.mcpMarketplaceEnabled) {
					payload.mcpMarketplaceEnabled = mcpMarketplaceEnabled
				}
				if (!isEqual(apiConfiguration, initialSettings.apiConfiguration)) {
					payload.apiConfiguration = apiConfigurationToSubmit
				}
			} else {
				// Fallback if initialSettings is null (should ideally not happen here)
				// Send all current values as a precaution, though this path indicates an issue.
				payload.planActSeparateModelsSetting = planActSeparateModelsSetting
				payload.customInstructionsSetting = customInstructions
				payload.telemetrySetting = telemetrySetting
				payload.enableCheckpointsSetting = enableCheckpointsSetting
				payload.mcpMarketplaceEnabled = mcpMarketplaceEnabled
				payload.apiConfiguration = apiConfigurationToSubmit
			}

			// Only send if there's actually something to update besides the type
			if (Object.keys(payload).length > 1) {
				vscode.postMessage(payload)
			}
		}

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
							},
						})
						setPendingTabChange(null)
					}
					break
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

	return (
		<div className="fixed top-0 left-0 right-0 bottom-0 pt-[10px] pr-0 pb-0 pl-5 flex flex-col overflow-hidden">
			<div className="flex justify-between items-center mb-[13px] pr-[17px]">
				<h3 className="text-[var(--vscode-foreground)] m-0">Settings</h3>
				<VSCodeButton onClick={() => handleSubmit(false)}>{hasChanges ? "Save" : "Done"}</VSCodeButton>
			</div>
			<div className="grow overflow-y-scroll pr-2 flex flex-col">
				{/* Tabs container */}
				{planActSeparateModelsSetting ? (
					<div className="border border-solid border-[var(--vscode-panel-border)] rounded-md p-[10px] mb-5 bg-[var(--vscode-panel-background)]">
						<div className="flex gap-[1px] mb-[10px] -mt-2 border-0 border-b border-solid border-[var(--vscode-panel-border)]">
							<TabButton isActive={chatSettings.mode === "plan"} onClick={() => handleTabChange("plan")}>
								Plan Mode
							</TabButton>
							<TabButton isActive={chatSettings.mode === "act"} onClick={() => handleTabChange("act")}>
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

				<div className="mb-[5px]">
					<VSCodeTextArea
						value={customInstructions ?? ""}
						className="w-full"
						resize="vertical"
						rows={4}
						placeholder={'e.g. "Run unit tests at the end", "Use TypeScript with async/await", "Speak in Spanish"'}
						onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
						<span className="font-medium">Custom Instructions</span>
					</VSCodeTextArea>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						These instructions are added to the end of the system prompt sent with every request.
					</p>
				</div>

				{chatSettings && <PreferredLanguageSetting chatSettings={chatSettings} setChatSettings={setChatSettings} />}

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
						Switching between Plan and Act mode will persist the API and model used in the previous mode. This may be
						helpful e.g. when using a strong reasoning model to architect a plan for a cheaper coding model to act on.
					</p>
				</div>

				<div className="mb-[5px]">
					<VSCodeCheckbox
						className="mb-[5px]"
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						Allow anonymous error and usage reporting
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Help improve Cline by sending anonymous usage data and error reports. No code, prompts, or personal
						information are ever sent. See our{" "}
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

				{/* Feature Settings Section */}
				<FeatureSettingsSection />

				{/* Browser Settings Section */}
				<BrowserSettingsSection />

				{/* Terminal Settings Section */}
				<TerminalSettingsSection />

				{IS_DEV && (
					<>
						<div className="mt-[10px] mb-1">Debug</div>
						<VSCodeButton
							onClick={handleResetState}
							className="mt-[5px] w-auto"
							style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
							Reset State
						</VSCodeButton>
						<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
							This will reset all global state and secret storage in the extension.
						</p>
					</>
				)}

				<div className="text-center text-[var(--vscode-descriptionForeground)] text-xs leading-[1.2] px-0 py-0 pr-2 pb-[15px] mt-auto">
					<p className="break-words m-0 p-0">
						If you have any questions or feedback, feel free to open an issue at{" "}
						<VSCodeLink href="https://github.com/cline/cline" className="inline">
							https://github.com/cline/cline
						</VSCodeLink>
					</p>
					<p className="italic mt-[10px] mb-0 p-0">v{version}</p>
				</div>
			</div>
		</div>
	)
}

export default memo(SettingsView)
