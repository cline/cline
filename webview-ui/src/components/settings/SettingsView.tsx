import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	CheckCheck,
	SquareMousePointer,
	Webhook,
	GitBranch,
	Bell,
	Database,
	SquareTerminal,
	FlaskConical,
	AlertTriangle,
	Globe,
	Info,
	LucideIcon,
} from "lucide-react"
import { CaretSortIcon } from "@radix-ui/react-icons"

import { ExperimentId } from "../../../../src/shared/experiments"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"
import { ApiConfiguration } from "../../../../src/shared/api"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextType, useExtensionState } from "@/context/ExtensionStateContext"
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
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
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
import { ContextManagementSettings } from "./ContextManagementSettings"
import { TerminalSettings } from "./TerminalSettings"
import { ExperimentalSettings } from "./ExperimentalSettings"
import { LanguageSettings } from "./LanguageSettings"
import { About } from "./About"
import { Section } from "./Section"

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}

const sectionNames = [
	"providers",
	"autoApprove",
	"browser",
	"checkpoints",
	"notifications",
	"contextManagement",
	"terminal",
	"experimental",
	"language",
	"about",
] as const

type SectionName = (typeof sectionNames)[number]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>(({ onDone, targetSection }, ref) => {
	const { t } = useAppTranslation()

	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, version, settingsImportedAt } = extensionState

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const prevApiConfigName = useRef(currentApiConfigName)
	const confirmDialogHandler = useRef<() => void>()

	const [cachedState, setCachedState] = useState(extensionState)

	const {
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		allowedCommands,
		language,
		alwaysAllowBrowser,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysApproveResubmit,
		browserToolEnabled,
		browserViewportSize,
		enableCheckpoints,
		diffEnabled,
		experiments,
		fuzzyMatchThreshold,
		maxOpenTabsContext,
		maxWorkspaceFiles,
		mcpEnabled,
		requestDelaySeconds,
		remoteBrowserHost,
		screenshotQuality,
		soundEnabled,
		ttsEnabled,
		ttsSpeed,
		soundVolume,
		telemetrySetting,
		terminalOutputLineLimit,
		terminalShellIntegrationTimeout,
		terminalCommandDelay,
		terminalPowershellCounter,
		terminalZshClearEolMark,
		terminalZshOhMy,
		terminalZshP10k,
		terminalZdotdir,
		writeDelayMs,
		showRooIgnoredFiles,
		remoteBrowserEnabled,
		maxReadFileLine,
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

	// Bust the cache when settings are imported.
	useEffect(() => {
		if (settingsImportedAt) {
			setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
			setChangeDetected(false)
		}
	}, [settingsImportedAt, extensionState])

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
			return { ...prevState, experiments: { ...prevState.experiments, [id]: enabled } }
		})
	}, [])

	const setTelemetrySetting = useCallback((setting: TelemetrySetting) => {
		setCachedState((prevState) => {
			if (prevState.telemetrySetting === setting) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, telemetrySetting: setting }
		})
	}, [])

	const isSettingValid = !errorMessage

	const handleSubmit = () => {
		if (isSettingValid) {
			vscode.postMessage({ type: "language", text: language })
			vscode.postMessage({ type: "alwaysAllowReadOnly", bool: alwaysAllowReadOnly })
			vscode.postMessage({
				type: "alwaysAllowReadOnlyOutsideWorkspace",
				bool: alwaysAllowReadOnlyOutsideWorkspace,
			})
			vscode.postMessage({ type: "alwaysAllowWrite", bool: alwaysAllowWrite })
			vscode.postMessage({ type: "alwaysAllowWriteOutsideWorkspace", bool: alwaysAllowWriteOutsideWorkspace })
			vscode.postMessage({ type: "alwaysAllowExecute", bool: alwaysAllowExecute })
			vscode.postMessage({ type: "alwaysAllowBrowser", bool: alwaysAllowBrowser })
			vscode.postMessage({ type: "alwaysAllowMcp", bool: alwaysAllowMcp })
			vscode.postMessage({ type: "allowedCommands", commands: allowedCommands ?? [] })
			vscode.postMessage({ type: "browserToolEnabled", bool: browserToolEnabled })
			vscode.postMessage({ type: "soundEnabled", bool: soundEnabled })
			vscode.postMessage({ type: "ttsEnabled", bool: ttsEnabled })
			vscode.postMessage({ type: "ttsSpeed", value: ttsSpeed })
			vscode.postMessage({ type: "soundVolume", value: soundVolume })
			vscode.postMessage({ type: "diffEnabled", bool: diffEnabled })
			vscode.postMessage({ type: "enableCheckpoints", bool: enableCheckpoints })
			vscode.postMessage({ type: "browserViewportSize", text: browserViewportSize })
			vscode.postMessage({ type: "remoteBrowserHost", text: remoteBrowserHost })
			vscode.postMessage({ type: "remoteBrowserEnabled", bool: remoteBrowserEnabled })
			vscode.postMessage({ type: "fuzzyMatchThreshold", value: fuzzyMatchThreshold ?? 1.0 })
			vscode.postMessage({ type: "writeDelayMs", value: writeDelayMs })
			vscode.postMessage({ type: "screenshotQuality", value: screenshotQuality ?? 75 })
			vscode.postMessage({ type: "terminalOutputLineLimit", value: terminalOutputLineLimit ?? 500 })
			vscode.postMessage({ type: "terminalShellIntegrationTimeout", value: terminalShellIntegrationTimeout })
			vscode.postMessage({ type: "terminalCommandDelay", value: terminalCommandDelay })
			vscode.postMessage({ type: "terminalPowershellCounter", bool: terminalPowershellCounter })
			vscode.postMessage({ type: "terminalZshClearEolMark", bool: terminalZshClearEolMark })
			vscode.postMessage({ type: "terminalZshOhMy", bool: terminalZshOhMy })
			vscode.postMessage({ type: "terminalZshP10k", bool: terminalZshP10k })
			vscode.postMessage({ type: "terminalZdotdir", bool: terminalZdotdir })
			vscode.postMessage({ type: "mcpEnabled", bool: mcpEnabled })
			vscode.postMessage({ type: "alwaysApproveResubmit", bool: alwaysApproveResubmit })
			vscode.postMessage({ type: "requestDelaySeconds", value: requestDelaySeconds })
			vscode.postMessage({ type: "maxOpenTabsContext", value: maxOpenTabsContext })
			vscode.postMessage({ type: "maxWorkspaceFiles", value: maxWorkspaceFiles ?? 200 })
			vscode.postMessage({ type: "showRooIgnoredFiles", bool: showRooIgnoredFiles })
			vscode.postMessage({ type: "maxReadFileLine", value: maxReadFileLine ?? 500 })
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
	const checkpointsRef = useRef<HTMLDivElement>(null)
	const notificationsRef = useRef<HTMLDivElement>(null)
	const contextManagementRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<HTMLDivElement>(null)
	const experimentalRef = useRef<HTMLDivElement>(null)
	const languageRef = useRef<HTMLDivElement>(null)
	const aboutRef = useRef<HTMLDivElement>(null)

	const sections: { id: SectionName; icon: LucideIcon; ref: React.RefObject<HTMLDivElement> }[] = useMemo(
		() => [
			{ id: "providers", icon: Webhook, ref: providersRef },
			{ id: "autoApprove", icon: CheckCheck, ref: autoApproveRef },
			{ id: "browser", icon: SquareMousePointer, ref: browserRef },
			{ id: "checkpoints", icon: GitBranch, ref: checkpointsRef },
			{ id: "notifications", icon: Bell, ref: notificationsRef },
			{ id: "contextManagement", icon: Database, ref: contextManagementRef },
			{ id: "terminal", icon: SquareTerminal, ref: terminalRef },
			{ id: "experimental", icon: FlaskConical, ref: experimentalRef },
			{ id: "language", icon: Globe, ref: languageRef },
			{ id: "about", icon: Info, ref: aboutRef },
		],
		[
			providersRef,
			autoApproveRef,
			browserRef,
			checkpointsRef,
			notificationsRef,
			contextManagementRef,
			terminalRef,
			experimentalRef,
		],
	)

	const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView()

	// Scroll to target section when specified
	useEffect(() => {
		if (targetSection) {
			const sectionObj = sections.find((section) => section.id === targetSection)
			if (sectionObj && sectionObj.ref.current) {
				// Use setTimeout to ensure the scroll happens after render
				setTimeout(() => scrollToSection(sectionObj.ref), 500)
			}
		}
	}, [targetSection, sections])

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-vscode-foreground m-0">{t("settings:header.title")}</h3>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="w-6 h-6">
								<CaretSortIcon />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="bottom">
							{sections.map(({ id, icon: Icon, ref }) => (
								<DropdownMenuItem key={id} onClick={() => scrollToSection(ref)}>
									<Icon />
									<span>{t(`settings:sections.${id}`)}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div className="flex gap-2">
					<Button
						variant={isSettingValid ? "default" : "secondary"}
						className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
						title={
							!isSettingValid
								? errorMessage
								: isChangeDetected
									? t("settings:header.saveButtonTooltip")
									: t("settings:header.nothingChangedTooltip")
						}
						onClick={handleSubmit}
						disabled={!isChangeDetected || !isSettingValid}
						data-testid="save-button">
						{t("settings:common.save")}
					</Button>
					<Button
						variant="secondary"
						title={t("settings:header.doneButtonTooltip")}
						onClick={() => checkUnsaveChanges(onDone)}>
						{t("settings:common.done")}
					</Button>
				</div>
			</TabHeader>

			<TabContent className="p-0 divide-y divide-vscode-sideBar-background">
				<div ref={providersRef}>
					<SectionHeader>
						<div className="flex items-center gap-2">
							<Webhook className="w-4" />
							<div>{t("settings:sections.providers")}</div>
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
						alwaysAllowReadOnlyOutsideWorkspace={alwaysAllowReadOnlyOutsideWorkspace}
						alwaysAllowWrite={alwaysAllowWrite}
						alwaysAllowWriteOutsideWorkspace={alwaysAllowWriteOutsideWorkspace}
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

				<div ref={checkpointsRef}>
					<CheckpointSettings
						enableCheckpoints={enableCheckpoints}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={notificationsRef}>
					<NotificationSettings
						ttsEnabled={ttsEnabled}
						ttsSpeed={ttsSpeed}
						soundEnabled={soundEnabled}
						soundVolume={soundVolume}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={contextManagementRef}>
					<ContextManagementSettings
						maxOpenTabsContext={maxOpenTabsContext}
						maxWorkspaceFiles={maxWorkspaceFiles ?? 200}
						showRooIgnoredFiles={showRooIgnoredFiles}
						maxReadFileLine={maxReadFileLine}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={terminalRef}>
					<TerminalSettings
						terminalOutputLineLimit={terminalOutputLineLimit}
						terminalShellIntegrationTimeout={terminalShellIntegrationTimeout}
						terminalCommandDelay={terminalCommandDelay}
						terminalPowershellCounter={terminalPowershellCounter}
						terminalZshClearEolMark={terminalZshClearEolMark}
						terminalZshOhMy={terminalZshOhMy}
						terminalZshP10k={terminalZshP10k}
						terminalZdotdir={terminalZdotdir}
						setCachedStateField={setCachedStateField}
					/>
				</div>

				<div ref={experimentalRef}>
					<ExperimentalSettings
						setCachedStateField={setCachedStateField}
						setExperimentEnabled={setExperimentEnabled}
						experiments={experiments}
					/>
				</div>

				<div ref={languageRef}>
					<LanguageSettings language={language || "en"} setCachedStateField={setCachedStateField} />
				</div>

				<div ref={aboutRef}>
					<About
						version={version}
						telemetrySetting={telemetrySetting}
						setTelemetrySetting={setTelemetrySetting}
					/>
				</div>
			</TabContent>

			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<AlertTriangle className="w-5 h-5 text-yellow-500" />
							{t("settings:unsavedChangesDialog.title")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:unsavedChangesDialog.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>
							{t("settings:unsavedChangesDialog.cancelButton")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>
							{t("settings:unsavedChangesDialog.discardButton")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Tab>
	)
})

export default memo(SettingsView)
