import { HTMLAttributes, useState } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { CheckCheck } from "lucide-react"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AutoApproveSettingsProps = HTMLAttributes<HTMLDivElement> & {
	alwaysAllowReadOnly?: boolean
	alwaysAllowWrite?: boolean
	writeDelayMs: number
	alwaysAllowBrowser?: boolean
	alwaysApproveResubmit?: boolean
	requestDelaySeconds: number
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysAllowExecute?: boolean
	allowedCommands?: string[]
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

export const AutoApproveSettings = ({
	alwaysAllowReadOnly,
	alwaysAllowWrite,
	writeDelayMs,
	alwaysAllowBrowser,
	alwaysApproveResubmit,
	requestDelaySeconds,
	alwaysAllowMcp,
	alwaysAllowModeSwitch,
	alwaysAllowSubtasks,
	alwaysAllowExecute,
	allowedCommands,
	setCachedStateField,
	className,
	...props
}: AutoApproveSettingsProps) => {
	const [commandInput, setCommandInput] = useState("")

	const handleAddCommand = () => {
		const currentCommands = allowedCommands ?? []
		if (commandInput && !currentCommands.includes(commandInput)) {
			const newCommands = [...currentCommands, commandInput]
			setCachedStateField("allowedCommands", newCommands)
			setCommandInput("")
			vscode.postMessage({ type: "allowedCommands", commands: newCommands })
		}
	}

	return (
		<div {...props}>
			<SectionHeader description="Allow Roo to automatically perform operations without requiring approval. Enable these settings only if you fully trust the AI and understand the associated security risks.">
				<div className="flex items-center gap-2">
					<CheckCheck className="w-4" />
					<div>Auto-Approve</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={alwaysAllowReadOnly}
						onChange={(e: any) => setCachedStateField("alwaysAllowReadOnly", e.target.checked)}>
						<span className="font-medium">Always approve read-only operations</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will automatically view directory contents and read files without requiring
						you to click the Approve button.
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowWrite}
						onChange={(e: any) => setCachedStateField("alwaysAllowWrite", e.target.checked)}>
						<span className="font-medium">Always approve write operations</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
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
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								Delay after writes to allow diagnostics to detect potential problems
							</p>
						</div>
					)}
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowBrowser}
						onChange={(e: any) => setCachedStateField("alwaysAllowBrowser", e.target.checked)}>
						<span className="font-medium">Always approve browser actions</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Automatically perform browser actions without requiring approval
						<br />
						Note: Only applies when the model supports computer use
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysApproveResubmit}
						onChange={(e: any) => setCachedStateField("alwaysApproveResubmit", e.target.checked)}>
						<span className="font-medium">Always retry failed API requests</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
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
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								Delay before retrying the request
							</p>
						</div>
					)}
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowMcp}
						onChange={(e: any) => setCachedStateField("alwaysAllowMcp", e.target.checked)}>
						<span className="font-medium">Always approve MCP tools</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Enable auto-approval of individual MCP tools in the MCP Servers view (requires both this setting
						and the tool's individual "Always allow" checkbox)
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowModeSwitch}
						onChange={(e: any) => setCachedStateField("alwaysAllowModeSwitch", e.target.checked)}>
						<span className="font-medium">Always approve mode switching</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Automatically switch between different modes without requiring approval
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowSubtasks}
						onChange={(e: any) => setCachedStateField("alwaysAllowSubtasks", e.target.checked)}>
						<span className="font-medium">Always approve creation & completion of subtasks</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Allow creation and completion of subtasks without requiring approval
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowExecute}
						onChange={(e: any) => setCachedStateField("alwaysAllowExecute", e.target.checked)}>
						<span className="font-medium">Always approve allowed execute operations</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Automatically execute allowed terminal commands without requiring approval
					</p>
					{alwaysAllowExecute && (
						<div
							style={{
								marginTop: 10,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<span className="font-medium">Allowed Auto-Execute Commands</span>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								Command prefixes that can be auto-executed when "Always approve execute operations" is
								enabled. Add * to allow all commands (use with caution).
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
												vscode.postMessage({ type: "allowedCommands", commands: newCommands })
											}}>
											<span className="codicon codicon-close" />
										</VSCodeButton>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
