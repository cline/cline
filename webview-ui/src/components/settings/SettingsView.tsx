import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "./ApiOptions"
import ApiConfigManager from "./ApiConfigManager"
import { Dropdown } from "vscrui"
import type { DropdownOption } from "vscrui"

type SettingsViewProps = {
	onDone: () => void
}

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const {
		apiConfiguration,
		version,
		alwaysAllowReadOnly,
		setAlwaysAllowReadOnly,
		alwaysAllowWrite,
		setAlwaysAllowWrite,
		alwaysAllowExecute,
		setAlwaysAllowExecute,
		alwaysAllowBrowser,
		setAlwaysAllowBrowser,
		alwaysAllowMcp,
		setAlwaysAllowMcp,
		soundEnabled,
		setSoundEnabled,
		soundVolume,
		setSoundVolume,
		diffEnabled,
		setDiffEnabled,
		browserViewportSize,
		setBrowserViewportSize,
		openRouterModels,
		glamaModels,
		setAllowedCommands,
		allowedCommands,
		fuzzyMatchThreshold,
		setFuzzyMatchThreshold,
		writeDelayMs,
		setWriteDelayMs,
		screenshotQuality,
		setScreenshotQuality,
		terminalOutputLineLimit,
		setTerminalOutputLineLimit,
		mcpEnabled,
		alwaysApproveResubmit,
		setAlwaysApproveResubmit,
		requestDelaySeconds,
		setRequestDelaySeconds,
		currentApiConfigName,
		listApiConfigMeta,
		experimentalDiffStrategy,
		setExperimentalDiffStrategy,
		alwaysAllowModeSwitch,
		setAlwaysAllowModeSwitch,
	} = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const [commandInput, setCommandInput] = useState("")

	const handleSubmit = () => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, glamaModels, openRouterModels)

		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)
		if (!apiValidationResult && !modelIdValidationResult) {
			vscode.postMessage({
				type: "apiConfiguration",
				apiConfiguration,
			})
			vscode.postMessage({ type: "alwaysAllowReadOnly", bool: alwaysAllowReadOnly })
			vscode.postMessage({ type: "alwaysAllowWrite", bool: alwaysAllowWrite })
			vscode.postMessage({ type: "alwaysAllowExecute", bool: alwaysAllowExecute })
			vscode.postMessage({ type: "alwaysAllowBrowser", bool: alwaysAllowBrowser })
			vscode.postMessage({ type: "alwaysAllowMcp", bool: alwaysAllowMcp })
			vscode.postMessage({ type: "allowedCommands", commands: allowedCommands ?? [] })
			vscode.postMessage({ type: "soundEnabled", bool: soundEnabled })
			vscode.postMessage({ type: "soundVolume", value: soundVolume })
			vscode.postMessage({ type: "diffEnabled", bool: diffEnabled })
			vscode.postMessage({ type: "browserViewportSize", text: browserViewportSize })
			vscode.postMessage({ type: "fuzzyMatchThreshold", value: fuzzyMatchThreshold ?? 1.0 })
			vscode.postMessage({ type: "writeDelayMs", value: writeDelayMs })
			vscode.postMessage({ type: "screenshotQuality", value: screenshotQuality ?? 75 })
			vscode.postMessage({ type: "terminalOutputLineLimit", value: terminalOutputLineLimit ?? 500 })
			vscode.postMessage({ type: "mcpEnabled", bool: mcpEnabled })
			vscode.postMessage({ type: "alwaysApproveResubmit", bool: alwaysApproveResubmit })
			vscode.postMessage({ type: "requestDelaySeconds", value: requestDelaySeconds })
			vscode.postMessage({ type: "currentApiConfigName", text: currentApiConfigName })
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName,
				apiConfiguration,
			})
			vscode.postMessage({ type: "experimentalDiffStrategy", bool: experimentalDiffStrategy })
			vscode.postMessage({ type: "alwaysAllowModeSwitch", bool: alwaysAllowModeSwitch })
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// Initial validation on mount
	useEffect(() => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, glamaModels, openRouterModels)
		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)
	}, [apiConfiguration, glamaModels, openRouterModels])

	const handleResetState = () => {
		vscode.postMessage({ type: "resetState" })
	}

	const handleAddCommand = () => {
		const currentCommands = allowedCommands ?? []
		if (commandInput && !currentCommands.includes(commandInput)) {
			const newCommands = [...currentCommands, commandInput]
			setAllowedCommands(newCommands)
			setCommandInput("")
			vscode.postMessage({
				type: "allowedCommands",
				commands: newCommands,
			})
		}
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
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
					paddingRight: 17,
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Settings</h3>
				<VSCodeButton onClick={handleSubmit}>Done</VSCodeButton>
			</div>
			<div
				style={{ flexGrow: 1, overflowY: "scroll", paddingRight: 8, display: "flex", flexDirection: "column" }}>
				<div style={{ marginBottom: 40 }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Provider Settings</h3>
					<div style={{ marginBottom: 15 }}>
						<ApiConfigManager
							currentApiConfigName={currentApiConfigName}
							listApiConfigMeta={listApiConfigMeta}
							onSelectConfig={(configName: string) => {
								vscode.postMessage({
									type: "loadApiConfiguration",
									text: configName,
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
							}}
							onUpsertConfig={(configName: string) => {
								vscode.postMessage({
									type: "upsertApiConfiguration",
									text: configName,
									apiConfiguration,
								})
							}}
						/>
						<ApiOptions apiErrorMessage={apiErrorMessage} modelIdErrorMessage={modelIdErrorMessage} />
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
							onChange={(e: any) => setAlwaysAllowReadOnly(e.target.checked)}>
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
							onChange={(e: any) => setAlwaysAllowWrite(e.target.checked)}>
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
										onChange={(e) => setWriteDelayMs(parseInt(e.target.value))}
										style={{
											flex: 1,
											accentColor: "var(--vscode-button-background)",
											height: "2px",
										}}
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
							onChange={(e: any) => setAlwaysAllowBrowser(e.target.checked)}>
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
							onChange={(e: any) => setAlwaysApproveResubmit(e.target.checked)}>
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
										onChange={(e) => setRequestDelaySeconds(parseInt(e.target.value))}
										style={{
											flex: 1,
											accentColor: "var(--vscode-button-background)",
											height: "2px",
										}}
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
							onChange={(e: any) => setAlwaysAllowMcp(e.target.checked)}>
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
							onChange={(e: any) => setAlwaysAllowModeSwitch(e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Always approve mode switching</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically switch between different AI modes without requiring approval
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={alwaysAllowExecute}
							onChange={(e: any) => setAlwaysAllowExecute(e.target.checked)}>
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
									is enabled.
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
											style={{
												display: "flex",
												alignItems: "center",
												gap: "5px",
												backgroundColor: "var(--vscode-button-secondaryBackground)",
												padding: "2px 6px",
												borderRadius: "4px",
												border: "1px solid var(--vscode-button-secondaryBorder)",
												height: "24px",
											}}>
											<span>{cmd}</span>
											<VSCodeButton
												appearance="icon"
												style={{
													padding: 0,
													margin: 0,
													height: "20px",
													width: "20px",
													minWidth: "20px",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													color: "var(--vscode-button-foreground)",
												}}
												onClick={() => {
													const newCommands = (allowedCommands ?? []).filter(
														(_, i) => i !== index,
													)
													setAllowedCommands(newCommands)
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
									setBrowserViewportSize((value as DropdownOption).value)
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
						<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
							<span style={{ fontWeight: "500", minWidth: "100px" }}>Screenshot quality</span>
							<input
								type="range"
								min="1"
								max="100"
								step="1"
								value={screenshotQuality ?? 75}
								onChange={(e) => setScreenshotQuality(parseInt(e.target.value))}
								style={{
									flexGrow: 1,
									accentColor: "var(--vscode-button-background)",
									height: "2px",
								}}
							/>
							<span style={{ minWidth: "35px", textAlign: "left" }}>{screenshotQuality ?? 75}%</span>
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
						<VSCodeCheckbox checked={soundEnabled} onChange={(e: any) => setSoundEnabled(e.target.checked)}>
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
									onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
									style={{
										flexGrow: 1,
										accentColor: "var(--vscode-button-background)",
										height: "2px",
									}}
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
						<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
							<span style={{ fontWeight: "500", minWidth: "150px" }}>Terminal output limit</span>
							<input
								type="range"
								min="100"
								max="5000"
								step="100"
								value={terminalOutputLineLimit ?? 500}
								onChange={(e) => setTerminalOutputLineLimit(parseInt(e.target.value))}
								style={{
									flexGrow: 1,
									accentColor: "var(--vscode-button-background)",
									height: "2px",
								}}
							/>
							<span style={{ minWidth: "45px", textAlign: "left" }}>
								{terminalOutputLineLimit ?? 500}
							</span>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Maximum number of lines to include in terminal output when executing commands. When exceeded
							lines will be removed from the middle, saving tokens.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={diffEnabled}
							onChange={(e: any) => {
								setDiffEnabled(e.target.checked)
								if (!e.target.checked) {
									// Reset experimental strategy when diffs are disabled
									setExperimentalDiffStrategy(false)
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
							truncated full-file writes. Works best with the latest Claude 3.5 Sonnet model.
						</p>

						{diffEnabled && (
							<div
								style={{
									marginTop: 10,
									paddingLeft: 10,
									borderLeft: "2px solid var(--vscode-button-background)",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
									<span style={{ color: "var(--vscode-errorForeground)" }}>⚠️</span>
									<VSCodeCheckbox
										checked={experimentalDiffStrategy}
										onChange={(e: any) => setExperimentalDiffStrategy(e.target.checked)}>
										<span style={{ fontWeight: "500" }}>
											Use experimental unified diff strategy
										</span>
									</VSCodeCheckbox>
								</div>
								<p
									style={{
										fontSize: "12px",
										marginBottom: 15,
										color: "var(--vscode-descriptionForeground)",
									}}>
									Enable the experimental unified diff strategy. This strategy might reduce the number
									of retries caused by model errors but may cause unexpected behavior or incorrect
									edits. Only enable if you understand the risks and are willing to carefully review
									all changes.
								</p>

								<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
									<span style={{ fontWeight: "500", minWidth: "100px" }}>Match precision</span>
									<input
										type="range"
										min="0.8"
										max="1"
										step="0.005"
										value={fuzzyMatchThreshold ?? 1.0}
										onChange={(e) => {
											setFuzzyMatchThreshold(parseFloat(e.target.value))
										}}
										style={{
											flexGrow: 1,
											accentColor: "var(--vscode-button-background)",
											height: "2px",
										}}
									/>
									<span style={{ minWidth: "35px", textAlign: "left" }}>
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
							</div>
						)}
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
						v{version}
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
}

export default memo(SettingsView)
