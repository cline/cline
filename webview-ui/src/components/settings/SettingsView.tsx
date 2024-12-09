import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "./ApiOptions"

const IS_DEV = false // FIXME: use flags when packaging

type SettingsViewProps = {
	onDone: () => void
}

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const {
		apiConfiguration,
		version,
		customInstructions,
		setCustomInstructions,
		alwaysAllowReadOnly,
		setAlwaysAllowReadOnly,
		alwaysAllowWrite,
		setAlwaysAllowWrite,
		alwaysAllowExecute,
		setAlwaysAllowExecute,
		alwaysAllowBrowser,
		setAlwaysAllowBrowser,
		soundEnabled,
		setSoundEnabled,
		diffEnabled,
		setDiffEnabled,
		openRouterModels,
		setAllowedCommands,
		allowedCommands,
	} = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const [commandInput, setCommandInput] = useState("")

	const handleSubmit = () => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)
		if (!apiValidationResult && !modelIdValidationResult) {
			vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			vscode.postMessage({ type: "customInstructions", text: customInstructions })
			vscode.postMessage({ type: "alwaysAllowReadOnly", bool: alwaysAllowReadOnly })
			vscode.postMessage({ type: "alwaysAllowWrite", bool: alwaysAllowWrite })
			vscode.postMessage({ type: "alwaysAllowExecute", bool: alwaysAllowExecute })
			vscode.postMessage({ type: "alwaysAllowBrowser", bool: alwaysAllowBrowser })
			vscode.postMessage({ type: "allowedCommands", commands: allowedCommands ?? [] })
			vscode.postMessage({ type: "soundEnabled", bool: soundEnabled })
			vscode.postMessage({ type: "diffEnabled", bool: diffEnabled })
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
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)
		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)
	}, [apiConfiguration, openRouterModels])

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
				commands: newCommands
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
				<div style={{ marginBottom: 5 }}>
					<ApiOptions
						showModelOptions={true}
						apiErrorMessage={apiErrorMessage}
						modelIdErrorMessage={modelIdErrorMessage}
					/>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeTextArea
						value={customInstructions ?? ""}
						style={{ width: "100%" }}
						rows={4}
						placeholder={
							'e.g. "Run unit tests at the end", "Use TypeScript with async/await", "Speak in Spanish"'
						}
						onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
						<span style={{ fontWeight: "500" }}>Custom Instructions</span>
					</VSCodeTextArea>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						These instructions are added to the end of the system prompt sent with every request. Custom instructions set in .clinerules and .cursorrules in the working directory are also included.
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
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
						When enabled, Cline will automatically view directory contents and read files without requiring
						you to click the Approve button.
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeCheckbox
						checked={alwaysAllowWrite}
						onChange={(e: any) => setAlwaysAllowWrite(e.target.checked)}>
						<span style={{ fontWeight: "500" }}>Always approve write operations</span>
					</VSCodeCheckbox>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							padding: "8px",
							border: "1px solid var(--vscode-errorBorder)",
							borderRadius: "4px",
							color: "var(--vscode-errorForeground)",
						}}>
						⚠️ WARNING: When enabled, Cline will automatically create and edit files without requiring approval. This is potentially very dangerous and could lead to unwanted system modifications or security risks. Enable only if you fully trust the AI and understand the risks.
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeCheckbox
						checked={alwaysAllowBrowser}
						onChange={(e: any) => setAlwaysAllowBrowser(e.target.checked)}>
						<span style={{ fontWeight: "500" }}>Always approve browser actions</span>
					</VSCodeCheckbox>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							padding: "8px",
							backgroundColor: "var(--vscode-errorBackground)",
							border: "1px solid var(--vscode-errorBorder)",
							borderRadius: "4px",
							color: "var(--vscode-errorForeground)",
						}}>
						⚠️ WARNING: When enabled, Cline will automatically perform browser actions without requiring approval. This is potentially very dangerous and could lead to unwanted system modifications or security risks. Enable only if you fully trust the AI and understand the risks.<br/><br/>NOTE: The checkbox only applies when the model supports computer use.

					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeCheckbox
						checked={alwaysAllowExecute}
						onChange={(e: any) => setAlwaysAllowExecute(e.target.checked)}>
						<span style={{ fontWeight: "500" }}>Always approve allowed execute operations</span>
					</VSCodeCheckbox>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							padding: "8px",
							backgroundColor: "var(--vscode-errorBackground)",
							border: "1px solid var(--vscode-errorBorder)",
							borderRadius: "4px",
							color: "var(--vscode-errorForeground)",
						}}>
						⚠️ WARNING: When enabled, Cline will automatically execute allowed terminal commands without requiring approval. This is potentially very dangerous and could lead to unwanted system modifications or security risks. Enable only if you fully trust the AI and understand the risks.
					</p>
				</div>

				{alwaysAllowExecute && (
					<div style={{ marginBottom: 5 }}>
						<div style={{ marginBottom: "10px" }}>
							<span style={{ fontWeight: "500" }}>Allowed Auto-Execute Commands</span>
							<p style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
								Command prefixes that can be auto-executed when "Always approve execute operations" is enabled.
							</p>

							<div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
								<VSCodeTextField
									value={commandInput}
									onInput={(e: any) => setCommandInput(e.target.value)}
									placeholder="Enter command prefix (e.g., 'git ')"
									style={{ flexGrow: 1 }}
								/>
								<VSCodeButton onClick={handleAddCommand}>
									Add
								</VSCodeButton>
							</div>

							<div style={{ 
								marginTop: '10px',
								display: 'flex',
								flexWrap: 'wrap',
								gap: '5px'
							}}>
								{(allowedCommands ?? []).map((cmd, index) => (
									<div key={index} style={{
										display: 'flex',
										alignItems: 'center',
										gap: '5px',
										backgroundColor: 'var(--vscode-button-secondaryBackground)',
										padding: '2px 6px',
										borderRadius: '4px',
										border: '1px solid var(--vscode-button-secondaryBorder)',
										height: '24px'
									}}>
										<span>{cmd}</span>
										<VSCodeButton
											appearance="icon"
											style={{
												padding: 0,
												margin: 0,
												height: '20px',
												width: '20px',
												minWidth: '20px',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center'
											}}
											onClick={() => {
												const newCommands = (allowedCommands ?? []).filter((_, i) => i !== index)
												setAllowedCommands(newCommands)
												vscode.postMessage({
													type: "allowedCommands",
													commands: newCommands
												})
											}}
										>
											<span className="codicon codicon-close" />
										</VSCodeButton>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				<div style={{ marginBottom: 5 }}>
					<h4 style={{ fontWeight: 500, marginBottom: 10 }}>Experimental Features</h4>

					<div style={{ marginBottom: 5 }}>
						<VSCodeCheckbox checked={diffEnabled} onChange={(e: any) => setDiffEnabled(e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Enable editing through diffs (very experimental!)</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Cline will be able to apply diffs to make changes to files and will automatically reject truncated full-file edits.
						</p>
					</div>

					<div style={{ marginBottom: 5 }}>
						<VSCodeCheckbox checked={soundEnabled} onChange={(e: any) => setSoundEnabled(e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Enable sound effects</span>
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							When enabled, Cline will play sound effects for notifications and events.
						</p>
					</div>
				</div>

				{IS_DEV && (
					<>
						<div style={{ marginTop: "10px", marginBottom: "4px" }}>Debug</div>
						<VSCodeButton onClick={handleResetState} style={{ marginTop: "5px", width: "auto" }}>
							Reset State
						</VSCodeButton>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							This will reset all global state and secret storage in the extension.
						</p>
					</>
				)}

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
						<VSCodeLink href="https://github.com/RooVetGit/Roo-Cline" style={{ display: "inline" }}>
							https://github.com/RooVetGit/Roo-Cline
						</VSCodeLink>
					</p>
					<p style={{ fontStyle: "italic", margin: "10px 0 0 0", padding: 0 }}>v{version}</p>
				</div>
			</div>
		</div>
	)
}

export default memo(SettingsView)
