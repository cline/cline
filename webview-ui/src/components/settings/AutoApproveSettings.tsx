import { HTMLAttributes, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
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
	const { t } = useAppTranslation()
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
			<SectionHeader description={t("settings:autoApprove.description")}>
				<div className="flex items-center gap-2">
					<CheckCheck className="w-4" />
					<div>{t("settings:sections.autoApprove")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={alwaysAllowReadOnly}
						onChange={(e: any) => setCachedStateField("alwaysAllowReadOnly", e.target.checked)}
						data-testid="always-allow-readonly-checkbox">
						<span className="font-medium">{t("settings:autoApprove.readOnly.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.readOnly.description")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowWrite}
						onChange={(e: any) => setCachedStateField("alwaysAllowWrite", e.target.checked)}
						data-testid="always-allow-write-checkbox">
						<span className="font-medium">{t("settings:autoApprove.write.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.write.description")}
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
									data-testid="write-delay-slider"
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ minWidth: "45px", textAlign: "left" }}>{writeDelayMs}ms</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.write.delayLabel")}
							</p>
						</div>
					)}
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowBrowser}
						onChange={(e: any) => setCachedStateField("alwaysAllowBrowser", e.target.checked)}
						data-testid="always-allow-browser-checkbox">
						<span className="font-medium">{t("settings:autoApprove.browser.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.browser.description")}
						<br />
						{t("settings:autoApprove.browser.note")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysApproveResubmit}
						onChange={(e: any) => setCachedStateField("alwaysApproveResubmit", e.target.checked)}
						data-testid="always-approve-resubmit-checkbox">
						<span className="font-medium">{t("settings:autoApprove.retry.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.retry.description")}
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
									data-testid="request-delay-slider"
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ minWidth: "45px", textAlign: "left" }}>{requestDelaySeconds}s</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								{t("settings:autoApprove.retry.delayLabel")}
							</p>
						</div>
					)}
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowMcp}
						onChange={(e: any) => setCachedStateField("alwaysAllowMcp", e.target.checked)}
						data-testid="always-allow-mcp-checkbox">
						<span className="font-medium">{t("settings:autoApprove.mcp.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.mcp.description")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowModeSwitch}
						onChange={(e: any) => setCachedStateField("alwaysAllowModeSwitch", e.target.checked)}
						data-testid="always-allow-mode-switch-checkbox">
						<span className="font-medium">{t("settings:autoApprove.modeSwitch.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.modeSwitch.description")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowSubtasks}
						onChange={(e: any) => setCachedStateField("alwaysAllowSubtasks", e.target.checked)}
						data-testid="always-allow-subtasks-checkbox">
						<span className="font-medium">{t("settings:autoApprove.subtasks.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.subtasks.description")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={alwaysAllowExecute}
						onChange={(e: any) => setCachedStateField("alwaysAllowExecute", e.target.checked)}
						data-testid="always-allow-execute-checkbox">
						<span className="font-medium">{t("settings:autoApprove.execute.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:autoApprove.execute.description")}
					</p>
					{alwaysAllowExecute && (
						<div
							style={{
								marginTop: 10,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<span className="font-medium" data-testid="allowed-commands-heading">
								{t("settings:autoApprove.execute.allowedCommands")}
							</span>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								{t("settings:autoApprove.execute.allowedCommandsDescription")}
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
									placeholder={t("settings:autoApprove.execute.commandPlaceholder")}
									data-testid="command-input"
									style={{ flexGrow: 1 }}
								/>
								<VSCodeButton onClick={handleAddCommand} data-testid="add-command-button">
									{t("settings:autoApprove.execute.addButton")}
								</VSCodeButton>
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
											data-testid={`remove-command-${index}`}
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
