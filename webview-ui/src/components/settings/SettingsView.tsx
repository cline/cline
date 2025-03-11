import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Button as VSCodeButton } from "vscrui"
import {
	CheckCheck,
	SquareMousePointer,
	Webhook,
	GitBranch,
	Bell,
	Cog,
	FlaskConical,
	AlertTriangle,
} from "lucide-react"

import { ApiConfiguration } from "../../../../src/shared/api"
import { ExperimentId } from "../../../../src/shared/experiments"
import { TERMINAL_OUTPUT_LIMIT } from "../../../../src/shared/terminal"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextType, useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
	AlertDialogHeader,
	AlertDialogFooter,
	Button,
} from "@/components/ui"

import { Tab, TabContent, TabHeader } from "../common/Tab"
import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"
import { AutoApproveSettings } from "./AutoApproveSettings"
import { BrowserSettings } from "./BrowserSettings"
import { CheckpointSettings } from "./CheckpointSettings"
import { NotificationSettings } from "./NotificationSettings"
import { AdvancedSettings } from "./AdvancedSettings"
import { SettingsFooter } from "./SettingsFooter"
import { Section } from "./Section"
import { ExperimentalSettings } from "./ExperimentalSettings"

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}

type SettingsViewProps = {
	onDone: () => void
}

const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>(({ onDone }, ref) => {
	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, version } = extensionState

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const prevApiConfigName = useRef(currentApiConfigName)
	const confirmDialogHandler = useRef<() => void>()

	const [cachedState, setCachedState] = useState(extensionState)

	const {
		alwaysAllowReadOnly,
		allowedCommands,
		alwaysAllowBrowser,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowWrite,
		alwaysApproveResubmit,
		browserToolEnabled,
		browserViewportSize,
		enableCheckpoints,
		checkpointStorage,
		diffEnabled,
		experiments,
		fuzzyMatchThreshold,
		maxOpenTabsContext,
		mcpEnabled,
		rateLimitSeconds,
		requestDelaySeconds,
		remoteBrowserHost,
		screenshotQuality,
		soundEnabled,
		soundVolume,
		telemetrySetting,
		terminalOutputLimit,
		writeDelayMs,
		showRooIgnoredFiles,
		remoteBrowserEnabled,
	} = cachedState

	// Make sure apiConfiguration is initialized and managed by SettingsView.
	const apiConfiguration = useMemo(() => cachedState.apiConfiguration ?? {}, [cachedState.apiConfiguration])

	useEffect(() => {
		// Update only when currentApiConfigName is changed.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration.
		if (prevApiConfigName.current === currentApiConfigName) {
			return
		}

		setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
		prevApiConfigName.current = currentApiConfigName
		setChangeDetected(false)
	}, [currentApiConfigName, extensionState, isChangeDetected])

	const setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType> = useCallback((field, value) => {
		setCachedState((prevState) => {
			if (prevState[field] === value) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, [field]: value }
		})
	}, [])

	const setApiConfigurationField = useCallback(
		<K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
			setCachedState((prevState) => {
				if (prevState.apiConfiguration?.[field] === value) {
					return prevState
				}

				setChangeDetected(true)

				return { ...prevState, apiConfiguration: { ...prevState.apiConfiguration, [field]: value } }
			})
		},
		[],
	)

	const setExperimentEnabled: SetExperimentEnabled = useCallback((id: ExperimentId, enabled: boolean) => {
		setCachedState((prevState) => {
			if (prevState.experiments?.[id] === enabled) {
				return prevState
			}

			setChangeDetected(true)

			return {
				...prevState,
				experiments: { ...prevState.experiments, [id]: enabled },
			}
		})
	}, [])

	const setTelemetrySetting = useCallback((setting: TelemetrySetting) => {
		setCachedState((prevState) => {
			if (prevState.telemetrySetting === setting) {
				return prevState
			}
			setChangeDetected(true)
			return {
				...prevState,
				telemetrySetting: setting,
			}
		})
	}, [])

	const isSettingValid = !errorMessage

	const handleSubmit = () => {
		if (isSettingValid) {
			vscode.postMessage({ type: "alwaysAllowReadOnly", bool: alwaysAllowReadOnly })
			vscode.postMessage({ type: "alwaysAllowWrite", bool: alwaysAllowWrite })
			vscode.postMessage({ type: "alwaysAllowExecute", bool: alwaysAllowExecute })
			vscode.postMessage({ type: "alwaysAllowBrowser", bool: alwaysAllowBrowser })
			vscode.postMessage({ type: "alwaysAllowMcp", bool: alwaysAllowMcp })
			vscode.postMessage({ type: "allowedCommands", commands: allowedCommands ?? [] })
			vscode.postMessage({ type: "browserToolEnabled", bool: browserToolEnabled })
			vscode.postMessage({ type: "soundEnabled", bool: soundEnabled })
			vscode.postMessage({ type: "soundVolume", value: soundVolume })
			vscode.postMessage({ type: "diffEnabled", bool: diffEnabled })
			vscode.postMessage({ type: "enableCheckpoints", bool: enableCheckpoints })
			vscode.postMessage({ type: "checkpointStorage", text: checkpointStorage })
			vscode.postMessage({ type: "browserViewportSize", text: browserViewportSize })
			vscode.postMessage({ type: "remoteBrowserHost", text: remoteBrowserHost })
			vscode.postMessage({ type: "remoteBrowserEnabled", bool: remoteBrowserEnabled })
			vscode.postMessage({ type: "fuzzyMatchThreshold", value: fuzzyMatchThreshold ?? 1.0 })
			vscode.postMessage({ type: "writeDelayMs", value: writeDelayMs })
			vscode.postMessage({ type: "screenshotQuality", value: screenshotQuality ?? 75 })
			vscode.postMessage({ type: "terminalOutputLimit", value: terminalOutputLimit ?? TERMINAL_OUTPUT_LIMIT })
			vscode.postMessage({ type: "mcpEnabled", bool: mcpEnabled })
			vscode.postMessage({ type: "alwaysApproveResubmit", bool: alwaysApproveResubmit })
			vscode.postMessage({ type: "requestDelaySeconds", value: requestDelaySeconds })
			vscode.postMessage({ type: "rateLimitSeconds", value: rateLimitSeconds })
			vscode.postMessage({ type: "maxOpenTabsContext", value: maxOpenTabsContext })
			vscode.postMessage({ type: "showRooIgnoredFiles", bool: showRooIgnoredFiles })
			vscode.postMessage({ type: "currentApiConfigName", text: currentApiConfigName })
			vscode.postMessage({ type: "updateExperimental", values: experiments })
			vscode.postMessage({ type: "alwaysAllowModeSwitch", bool: alwaysAllowModeSwitch })
			vscode.postMessage({ type: "alwaysAllowSubtasks", bool: alwaysAllowSubtasks })
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
			vscode.postMessage({ type: "telemetrySetting", text: telemetrySetting })
			setChangeDetected(false)
		}
	}

	const checkUnsaveChanges = useCallback(
		(then: () => void) => {
			if (isChangeDetected) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[isChangeDetected],
	)

	useImperativeHandle(ref, () => ({ checkUnsaveChanges }), [checkUnsaveChanges])

	const onConfirmDialogResult = useCallback((confirm: boolean) => {
		if (confirm) {
			confirmDialogHandler.current?.()
		}
	}, [])

	const providersRef = useRef<HTMLDivElement>(null)
	const autoApproveRef = useRef<HTMLDivElement>(null)
	const browserRef = useRef<HTMLDivElement>(null)
	const checkpointRef = useRef<HTMLDivElement>(null)
	const notificationsRef = useRef<HTMLDivElement>(null)
	const advancedRef = useRef<HTMLDivElement>(null)
	const experimentalRef = useRef<HTMLDivElement>(null)

	const [activeSection, setActiveSection] = useState<string>("providers")

	const sections = useMemo(
		() => [
			{ id: "providers", icon: Webhook, ref: providersRef },
			{ id: "autoApprove", icon: CheckCheck, ref: autoApproveRef },
			{ id: "browser", icon: SquareMousePointer, ref: browserRef },
			{ id: "checkpoint", icon: GitBranch, ref: checkpointRef },
			{ id: "notifications", icon: Bell, ref: notificationsRef },
			{ id: "advanced", icon: Cog, ref: advancedRef },
			{ id: "experimental", icon: FlaskConical, ref: experimentalRef },
		],
		[providersRef, autoApproveRef, browserRef, checkpointRef, notificationsRef, advancedRef, experimentalRef],
	)

	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		const sections = [
			{ ref: providersRef, id: "providers" },
			{ ref: autoApproveRef, id: "autoApprove" },
			{ ref: browserRef, id: "browser" },
			{ ref: checkpointRef, id: "checkpoint" },
			{ ref: notificationsRef, id: "notifications" },
			{ ref: advancedRef, id: "advanced" },
			{ ref: experimentalRef, id: "experimental" },
		]

		for (const section of sections) {
			const element = section.ref.current

			if (element) {
				const { top } = element.getBoundingClientRect()

				if (top >= 0 && top <= 50) {
					setActiveSection(section.id)
					break
				}
			}
		}
	}, [])

	const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView()

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-2">
					<h3 className="text-vscode-foreground m-0">Settings</h3>
					<div className="hidden [@media(min-width:400px)]:flex items-center">
						{sections.map(({ id, icon: Icon, ref }) => (
							<Button
								key={id}
								variant="ghost"
								onClick={() => scrollToSection(ref)}
								className={cn("w-6 h-6", activeSection === id ? "opacity-100" : "opacity-40")}>
								<Icon />
							</Button>
						))}
					</div>
				</div>
				<div className="flex gap-2">
					<VSCodeButton
						appearance={isSettingValid ? "primary" : "secondary"}
						className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
						title={!isSettingValid ? errorMessage : isChangeDetected ? "Save changes" : "Nothing changed"}
						onClick={handleSubmit}
						disabled={!isChangeDetected || !isSettingValid}>
						Save
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						title="Discard unsaved changes and close settings panel"
						onClick={() => checkUnsaveChanges(onDone)}>
						Done
					</VSCodeButton>
				</div>
			</TabHeader>

			<TabContent className="p-0 divide-y divide-vscode-sideBar-background" onScroll={handleScroll}>
				<div ref={providersRef}>
					<SectionHeader>
						<div className="flex items-center gap-2">
							<Webhook className="w-4" />
							<div>Providers</div>
						</div>
					</SectionHeader>

					<Section>
						<ApiConfigManager
							currentApiConfigName={currentApiConfigName}
							listApiConfigMeta={listApiConfigMeta}
							onSelectConfig={(configName: string) =>
								checkUnsaveChanges(() =>
									vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
								)
							}
							onDeleteConfig={(configName: string) =>
								vscode.postMessage({ type: "deleteApiConfiguration", text: configName })
							}
							onRenameConfig={(oldName: string, newName: string) => {
								vscode.postMessage({
									type: "renameApiConfiguration",
									values: { oldName, newName },
									apiConfiguration,
								})
								prevApiConfigName.current = newName
							}}
							onUpsertConfig={(configName: string) =>
								vscode.postMessage({
									type: "upsertApiConfiguration",
									text: configName,
									apiConfiguration,
								})
							}
						/>
						<ApiOptions
							uriScheme={uriScheme}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							errorMessage={errorMessage}
							setErrorMessage={setErrorMessage}
						/>
					</Section>
				</div>

				<div ref={autoApproveRef}>
					<AutoApproveSettings
						alwaysAllowReadOnly={alwaysAllowReadOnly}
						alwaysAllowWrite={alwaysAllowWrite}
						writeDelayMs={writeDelayMs}
						alwaysAllowBrowser={alwaysAllowBrowser}
						alwaysApproveResubmit={alwaysApproveResubmit}
						requestDelaySeconds={requestDelaySeconds}
						alwaysAllowMcp={alwaysAllowMcp}
						alwaysAllowModeSwitch={alwaysAllowModeSwitch}
						alwaysAllowSubtasks={alwaysAllowSubtasks}
						alwaysAllowExecute={alwaysAllowExecute}
						allowedCommands={allowedCommands}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={browserRef}>
					<BrowserSettings
						browserToolEnabled={browserToolEnabled}
						browserViewportSize={browserViewportSize}
						screenshotQuality={screenshotQuality}
						remoteBrowserHost={remoteBrowserHost}
						remoteBrowserEnabled={remoteBrowserEnabled}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={checkpointRef}>
					<CheckpointSettings
						enableCheckpoints={enableCheckpoints}
						checkpointStorage={checkpointStorage}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={notificationsRef}>
					<NotificationSettings
						soundEnabled={soundEnabled}
						soundVolume={soundVolume}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={advancedRef}>
					<AdvancedSettings
						rateLimitSeconds={rateLimitSeconds}
						terminalOutputLimit={terminalOutputLimit}
						maxOpenTabsContext={maxOpenTabsContext}
						diffEnabled={diffEnabled}
						fuzzyMatchThreshold={fuzzyMatchThreshold}
						showRooIgnoredFiles={showRooIgnoredFiles}
						setCachedStateField={setCachedStateField}
						setExperimentEnabled={setExperimentEnabled}
						experiments={experiments}
					/>
				</div>

				<div ref={experimentalRef}>
					<ExperimentalSettings
						setCachedStateField={setCachedStateField}
						setExperimentEnabled={setExperimentEnabled}
						experiments={experiments}
					/>
				</div>

				<SettingsFooter
					version={version}
					telemetrySetting={telemetrySetting}
					setTelemetrySetting={setTelemetrySetting}
				/>
			</TabContent>

			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<AlertTriangle className="w-5 h-5 text-yellow-500" />
							Unsaved Changes
						</AlertDialogTitle>
						<AlertDialogDescription>Do you want to discard changes and continue?</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>
							Discard changes
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Tab>
	)
})

export default memo(SettingsView)
