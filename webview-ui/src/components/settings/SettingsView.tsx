import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Button, Dropdown, type DropdownOption } from "vscrui"

import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
	AlertDialogHeader,
	AlertDialogFooter,
} from "@/components/ui"

import { vscode } from "../../utils/vscode"
import { ExtensionStateContextType, useExtensionState } from "../../context/ExtensionStateContext"
import { EXPERIMENT_IDS, experimentConfigsMap, ExperimentId } from "../../../../src/shared/experiments"
import { ApiConfiguration } from "../../../../src/shared/api"

import ExperimentalFeature from "./ExperimentalFeature"
import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"

type SettingsViewProps = {
	onDone: () => void
}

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}

const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>(({ onDone }, ref) => {
	const extensionState = useExtensionState()
	const [commandInput, setCommandInput] = useState("")
	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [cachedState, setCachedState] = useState(extensionState)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const prevApiConfigName = useRef(extensionState.currentApiConfigName)
	const confirmDialogHandler = useRef<() => void>()
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	// TODO: Reduce WebviewMessage/ExtensionState complexity
	const { currentApiConfigName } = extensionState
	const {
		alwaysAllowReadOnly,
		allowedCommands,
		alwaysAllowBrowser,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowWrite,
		alwaysApproveResubmit,
		browserViewportSize,
		enableCheckpoints,
		diffEnabled,
		experiments,
		fuzzyMatchThreshold,
		maxOpenTabsContext,
		mcpEnabled,
		rateLimitSeconds,
		requestDelaySeconds,
		screenshotQuality,
		soundEnabled,
		soundVolume,
		terminalOutputLineLimit,
		writeDelayMs,
	} = cachedState

	//Make sure apiConfiguration is initialized and managed by SettingsView
	const apiConfiguration = useMemo(() => cachedState.apiConfiguration ?? {}, [cachedState.apiConfiguration])

	useEffect(() => {
		// Update only when currentApiConfigName is changed.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration.
		if (prevApiConfigName.current === currentApiConfigName) {
			return
		}

		setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
		prevApiConfigName.current = currentApiConfigName
		// console.log("useEffect: currentApiConfigName changed, setChangeDetected -> false")
		setChangeDetected(false)
	}, [currentApiConfigName, extensionState, isChangeDetected])

	const setCachedStateField = useCallback(
		<K extends keyof ExtensionStateContextType>(field: K, value: ExtensionStateContextType[K]) => {
			setCachedState((prevState) => {
				if (prevState[field] === value) {
					return prevState
				}

				// console.log(`setCachedStateField(${field} -> ${value}): setChangeDetected -> true`)
				setChangeDetected(true)
				return { ...prevState, [field]: value }
			})
		},
		[],
	)

	const setApiConfigurationField = useCallback(
		<K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => {
			setCachedState((prevState) => {
				if (prevState.apiConfiguration?.[field] === value) {
					return prevState
				}

				// console.log(`setApiConfigurationField(${field} -> ${value}): setChangeDetected -> true`)
				setChangeDetected(true)

				return { ...prevState, apiConfiguration: { ...prevState.apiConfiguration, [field]: value } }
			})
		},
		[],
	)

	const setExperimentEnabled = useCallback((id: ExperimentId, enabled: boolean) => {
		setCachedState((prevState) => {
			if (prevState.experiments?.[id] === enabled) {
				return prevState
			}

			// console.log("setExperimentEnabled: setChangeDetected -> true")
			setChangeDetected(true)

			return {
				...prevState,
				experiments: { ...prevState.experiments, [id]: enabled },
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
			vscode.postMessage({ type: "soundEnabled", bool: soundEnabled })
			vscode.postMessage({ type: "soundVolume", value: soundVolume })
			vscode.postMessage({ type: "diffEnabled", bool: diffEnabled })
			vscode.postMessage({ type: "enableCheckpoints", bool: enableCheckpoints })
			vscode.postMessage({ type: "browserViewportSize", text: browserViewportSize })
			vscode.postMessage({ type: "fuzzyMatchThreshold", value: fuzzyMatchThreshold ?? 1.0 })
			vscode.postMessage({ type: "writeDelayMs", value: writeDelayMs })
			vscode.postMessage({ type: "screenshotQuality", value: screenshotQuality ?? 75 })
			vscode.postMessage({ type: "terminalOutputLineLimit", value: terminalOutputLineLimit ?? 500 })
			vscode.postMessage({ type: "mcpEnabled", bool: mcpEnabled })
			vscode.postMessage({ type: "alwaysApproveResubmit", bool: alwaysApproveResubmit })
			vscode.postMessage({ type: "requestDelaySeconds", value: requestDelaySeconds })
			vscode.postMessage({ type: "rateLimitSeconds", value: rateLimitSeconds })
			vscode.postMessage({ type: "maxOpenTabsContext", value: maxOpenTabsContext })
			vscode.postMessage({ type: "currentApiConfigName", text: currentApiConfigName })
			vscode.postMessage({ type: "updateExperimental", values: experiments })
			vscode.postMessage({ type: "alwaysAllowModeSwitch", bool: alwaysAllowModeSwitch })
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
			// console.log("handleSubmit: setChangeDetected -> false")
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

	const handleResetState = () => {
		vscode.postMessage({ type: "resetState" })
	}

	const handleAddCommand = () => {
		const currentCommands = allowedCommands ?? []
		if (commandInput && !currentCommands.includes(commandInput)) {
			const newCommands = [...currentCommands, commandInput]
			setCachedStateField("allowedCommands", newCommands)
			setCommandInput("")
			vscode.postMessage({ type: "allowedCommands", commands: newCommands })
		}
	}

	const sliderLabelStyle = {
		minWidth: "45px",
		textAlign: "right" as const,
		lineHeight: "20px",
		paddingBottom: "2px",
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "10px 0px 0px 20px",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Unsaved changes</AlertDialogTitle>
						<AlertDialogDescription>
							<span className={`codicon codicon-warning align-middle mr-1`} />
							Do you want to discard changes and continue?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>Yes</AlertDialogAction>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>No</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
					paddingRight: 17,
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Settings</h3>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						gap: "6px",
					}}>
					<Button
						appearance={isSettingValid ? "primary" : "secondary"}
						className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
						title={!isSettingValid ? errorMessage : isChangeDetected ? "Save changes" : "Nothing changed"}
						onClick={handleSubmit}
						disabled={!isChangeDetected || !isSettingValid}>
						Save
					</Button>
					<VSCodeButton
						appearance="secondary"
						title="Discard unsaved changes and close settings panel"
						onClick={() => checkUnsaveChanges(onDone)}>
						Done
					</VSCodeButton>
				</div>
			</div>
			<div
				style={{ flexGrow: 1, overflowY: "scroll", paddingRight: 8, display: "flex", flexDirection: "column" }}>
				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Provider Settings</h3>
					<div style={{ marginBottom: 15 }}>
						<ApiConfigManager
							currentApiConfigName={currentApiConfigName}
							listApiConfigMeta={extensionState.listApiConfigMeta}
							onSelectConfig={(configName: string) => {
								checkUnsaveChanges(() => {
									vscode.postMessage({
										type: "loadApiConfiguration",
										text: configName,
									})
								})
							}}
							onDeleteConfig={(configName: string) => {
								vscode.postMessage({
									type: "deleteApiConfiguration",
									text: configName,
								})
							}}
							onRenameConfig={(oldName: string, newName: string) => {
								vscode.postMessage({
									type: "renameApiConfiguration",
									values: { oldName, newName },
									apiConfiguration,
								})
								prevApiConfigName.current = newName
							}}
							onUpsertConfig={(configName: string) => {
								vscode.postMessage({
									type: "upsertApiConfiguration",
									text: configName,
									apiConfiguration,
								})
							}}
						/>
						<ApiOptions
							uriScheme={extensionState.uriScheme}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							errorMessage={errorMessage}
							setErrorMessage={setErrorMessage}
						/>
					</div>
				</div>

				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Auto-Approve Settings</h3>
					<p style={{ fontSize: "12px", marginBottom: 15, color: "var(--vscode-descriptionForeground)" }}>
						The following settings allow Roo to automatically perform operations without requiring approval.
						Enable these settings only if you fully trust the AI and understand the associated security
						risks.
					</p>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowReadOnly}
							onChange={(e: any) => setCachedStateField("alwaysAllowReadOnly", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve read-only operations</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Roo will automatically view directory contents and read files without
							requiring you to click the Approve button.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowWrite}
							onChange={(e: any) => setCachedStateField("alwaysAllowWrite", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve write operations</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically create and edit files without requiring approval
						</p>
						{alwaysAllowWrite && (
							<div
								style={{
									marginTop: 10,
									paddingLeft: 10,
									borderLeft: "2px solid var(--vscode-button-background)",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
									<input
										type="range"
										min="0"
										max="5000"
										step="100"
										value={writeDelayMs}
										onChange={(e) => setCachedStateField("writeDelayMs", parseInt(e.target.value))}
										className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									/>
									<span style={{ minWidth: "45px", textAlign: "left" }}>{writeDelayMs}ms</span>
								</div>
								<p
									style={{
										fontSize: "12px",
										marginTop: "5px",
										color: "var(--vscode-descriptionForeground)",
									}}>
									Delay after writes to allow diagnostics to detect potential problems
								</p>
							</div>
						)}
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowBrowser}
							onChange={(e: any) => setCachedStateField("alwaysAllowBrowser", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve browser actions</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically perform browser actions without requiring approval
							<br />
							Note: Only applies when the model supports computer use
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysApproveResubmit}
							onChange={(e: any) => setCachedStateField("alwaysApproveResubmit", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always retry failed API requests</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically retry failed API requests when server returns an error response
						</p>
						{alwaysApproveResubmit && (
							<div
								style={{
									marginTop: 10,
									paddingLeft: 10,
									borderLeft: "2px solid var(--vscode-button-background)",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
									<input
										type="range"
										min="5"
										max="100"
										step="1"
										value={requestDelaySeconds}
										onChange={(e) =>
											setCachedStateField("requestDelaySeconds", parseInt(e.target.value))
										}
										className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									/>
									<span style={{ minWidth: "45px", textAlign: "left" }}>{requestDelaySeconds}s</span>
								</div>
								<p
									style={{
										fontSize: "12px",
										marginTop: "5px",
										color: "var(--vscode-descriptionForeground)",
									}}>
									Delay before retrying the request
								</p>
							</div>
						)}
					</div>

					<div style={{ marginBottom: 5 }}>
						<VSCodeCheckbox
							checked={alwaysAllowMcp}
							onChange={(e: any) => setCachedStateField("alwaysAllowMcp", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve MCP tools</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Enable auto-approval of individual MCP tools in the MCP Servers view (requires both this
							setting and the tool's individual "Always allow" checkbox)
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowModeSwitch}
							onChange={(e: any) => setCachedStateField("alwaysAllowModeSwitch", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve mode switching & task creation</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically switch between different AI modes and create new tasks without requiring
							approval
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowExecute}
							onChange={(e: any) => setCachedStateField("alwaysAllowExecute", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve allowed execute operations</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically execute allowed terminal commands without requiring approval
						</p>

						{alwaysAllowExecute && (
							<div
								style={{
									marginTop: 10,
									paddingLeft: 10,
									borderLeft: "2px solid var(--vscode-button-background)",
								}}>
								<span style={{ fontWeight: "500" }}>Allowed Auto-Execute Commands</span>
								<p
									style={{
										fontSize: "12px",
										marginTop: "5px",
										color: "var(--vscode-descriptionForeground)",
									}}>
									Command prefixes that can be auto-executed when "Always approve execute operations"
									is enabled. Add * to allow all commands (use with caution).
								</p>

								<div style={{ display: "flex", gap: "5px", marginTop: "10px" }}>
									<VSCodeTextField
										value={commandInput}
										onInput={(e: any) => setCommandInput(e.target.value)}
										onKeyDown={(e: any) => {
											if (e.key === "Enter") {
												e.preventDefault()
												handleAddCommand()
											}
										}}
										placeholder="Enter command prefix (e.g., 'git ')"
										style={{ flexGrow: 1 }}
									/>
									<VSCodeButton onClick={handleAddCommand}>Add</VSCodeButton>
								</div>

								<div
									style={{
										marginTop: "10px",
										display: "flex",
										flexWrap: "wrap",
										gap: "5px",
									}}>
									{(allowedCommands ?? []).map((cmd, index) => (
										<div
											key={index}
											className="border border-vscode-input-border bg-primary text-primary-foreground flex items-center gap-1 rounded-xs px-1.5 p-0.5">
											<span>{cmd}</span>
											<VSCodeButton
												appearance="icon"
												className="text-primary-foreground"
												onClick={() => {
													const newCommands = (allowedCommands ?? []).filter(
														(_, i) => i !== index,
													)
													setCachedStateField("allowedCommands", newCommands)
													vscode.postMessage({
														type: "allowedCommands",
														commands: newCommands,
													})
												}}>
												<span className="codicon codicon-close" />
											</VSCodeButton>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Browser Settings</h3>
					<div style={{ marginBottom: 15 }}>
						<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Viewport size</label>
						<div className="dropdown-container">
							<Dropdown
								value={browserViewportSize}
								onChange={(value: unknown) => {
									setCachedStateField("browserViewportSize", (value as DropdownOption).value)
								}}
								style={{ width: "100%" }}
								options={[
									{ value: "1280x800", label: "Large Desktop (1280x800)" },
									{ value: "900x600", label: "Small Desktop (900x600)" },
									{ value: "768x1024", label: "Tablet (768x1024)" },
									{ value: "360x640", label: "Mobile (360x640)" },
								]}
							/>
						</div>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							Select the viewport size for browser interactions. This affects how websites are displayed
							and interacted with.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
							<span style={{ fontWeight: "500" }}>Screenshot quality</span>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="1"
									max="100"
									step="1"
									value={screenshotQuality ?? 75}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									onChange={(e) => setCachedStateField("screenshotQuality", parseInt(e.target.value))}
								/>
								<span style={{ ...sliderLabelStyle }}>{screenshotQuality ?? 75}%</span>
							</div>
						</div>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							Adjust the WebP quality of browser screenshots. Higher values provide clearer screenshots
							but increase token usage.
						</p>
					</div>
				</div>

				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Notification Settings</h3>
					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={soundEnabled}
							onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Enable sound effects</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Roo will play sound effects for notifications and events.
						</p>
					</div>
					{soundEnabled && (
						<div
							style={{
								marginLeft: 0,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<span style={{ fontWeight: "500", minWidth: "100px" }}>Volume</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={soundVolume ?? 0.5}
									onChange={(e) => setCachedStateField("soundVolume", parseFloat(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									aria-label="Volume"
								/>
								<span style={{ minWidth: "35px", textAlign: "left" }}>
									{((soundVolume ?? 0.5) * 100).toFixed(0)}%
								</span>
							</div>
						</div>
					)}
				</div>

				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Advanced Settings</h3>
					<div style={{ marginBottom: 15 }}>
						<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
							<span style={{ fontWeight: "500" }}>Rate limit</span>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="0"
									max="60"
									step="1"
									value={rateLimitSeconds}
									onChange={(e) => setCachedStateField("rateLimitSeconds", parseInt(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ ...sliderLabelStyle }}>{rateLimitSeconds}s</span>
							</div>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Minimum time between API requests.
						</p>
					</div>
					<div style={{ marginBottom: 15 }}>
						<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
							<span style={{ fontWeight: "500" }}>Terminal output limit</span>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="100"
									max="5000"
									step="100"
									value={terminalOutputLineLimit ?? 500}
									onChange={(e) =>
										setCachedStateField("terminalOutputLineLimit", parseInt(e.target.value))
									}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ ...sliderLabelStyle }}>{terminalOutputLineLimit ?? 500}</span>
							</div>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Maximum number of lines to include in terminal output when executing commands. When exceeded
							lines will be removed from the middle, saving tokens.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
							<span style={{ fontWeight: "500" }}>Open tabs context limit</span>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="0"
									max="500"
									step="1"
									value={maxOpenTabsContext ?? 20}
									onChange={(e) =>
										setCachedStateField("maxOpenTabsContext", parseInt(e.target.value))
									}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ ...sliderLabelStyle }}>{maxOpenTabsContext ?? 20}</span>
							</div>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Maximum number of VSCode open tabs to include in context. Higher values provide more context
							but increase token usage.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={enableCheckpoints}
							onChange={(e: any) => {
								setCachedStateField("enableCheckpoints", e.target.checked)
							}}>
							<span style={{ fontWeight: "500" }}>Enable automatic checkpoints</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Roo will automatically create checkpoints during task execution, making it
							easy to review changes or revert to earlier states.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={diffEnabled}
							onChange={(e: any) => {
								setCachedStateField("diffEnabled", e.target.checked)
								if (!e.target.checked) {
									// Reset experimental strategy when diffs are disabled
									setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
								}
							}}>
							<span style={{ fontWeight: "500" }}>Enable editing through diffs</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Roo will be able to edit files more quickly and will automatically reject
							truncated full-file writes. Works best with the latest Claude 3.7 Sonnet model.
						</p>

						{diffEnabled && (
							<div style={{ marginTop: 10 }}>
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "5px",
										marginTop: "10px",
										marginBottom: "10px",
										paddingLeft: "10px",
										borderLeft: "2px solid var(--vscode-button-background)",
									}}>
									<span style={{ fontWeight: "500" }}>Match precision</span>
									<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
										<input
											type="range"
											min="0.8"
											max="1"
											step="0.005"
											value={fuzzyMatchThreshold ?? 1.0}
											onChange={(e) => {
												setCachedStateField("fuzzyMatchThreshold", parseFloat(e.target.value))
											}}
											className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
										/>
										<span style={{ ...sliderLabelStyle }}>
											{Math.round((fuzzyMatchThreshold || 1) * 100)}%
										</span>
									</div>
									<p
										style={{
											fontSize: "12px",
											marginTop: "5px",
											color: "var(--vscode-descriptionForeground)",
										}}>
										This slider controls how precisely code sections must match when applying diffs.
										Lower values allow more flexible matching but increase the risk of incorrect
										replacements. Use values below 100% with extreme caution.
									</p>
									<ExperimentalFeature
										key={EXPERIMENT_IDS.DIFF_STRATEGY}
										{...experimentConfigsMap.DIFF_STRATEGY}
										enabled={experiments[EXPERIMENT_IDS.DIFF_STRATEGY] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, enabled)
										}
									/>
								</div>
							</div>
						)}

						{Object.entries(experimentConfigsMap)
							.filter((config) => config[0] !== "DIFF_STRATEGY")
							.map((config) => (
								<ExperimentalFeature
									key={config[0]}
									{...config[1]}
									enabled={
										experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
											enabled,
										)
									}
								/>
							))}
					</div>
				</div>

				<div
					style={{
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "12px",
						lineHeight: "1.2",
						marginTop: "auto",
						padding: "10px 8px 15px 0px",
					}}>
					<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
						If you have any questions or feedback, feel free to open an issue at{" "}
						<VSCodeLink href="https://github.com/RooVetGit/Roo-Code" style={{ display: "inline" }}>
							github.com/RooVetGit/Roo-Code
						</VSCodeLink>{" "}
						or join{" "}
						<VSCodeLink href="https://www.reddit.com/r/RooCode/" style={{ display: "inline" }}>
							reddit.com/r/RooCode
						</VSCodeLink>
					</p>
					<p style={{ fontStyle: "italic", margin: "10px 0 0 0", padding: 0, marginBottom: 100 }}>
						v{extensionState.version}
					</p>

					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This will reset all global state and secret storage in the extension.
					</p>

					<VSCodeButton
						onClick={handleResetState}
						appearance="secondary"
						style={{ marginTop: "5px", width: "auto" }}>
						Reset State
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
})

export default memo(SettingsView)
