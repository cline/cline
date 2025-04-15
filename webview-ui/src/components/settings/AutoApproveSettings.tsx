import { HTMLAttributes, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeButton, VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AutoApproveSettingsProps = HTMLAttributes<HTMLDivElement> & {
	alwaysAllowReadOnly?: boolean
	alwaysAllowReadOnlyOutsideWorkspace?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowWriteOutsideWorkspace?: boolean
	writeDelayMs: number
	alwaysAllowBrowser?: boolean
	alwaysApproveResubmit?: boolean
	requestDelaySeconds: number
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysAllowExecute?: boolean
	allowedCommands?: string[]
	setCachedStateField: SetCachedStateField<
		| "alwaysAllowReadOnly"
		| "alwaysAllowReadOnlyOutsideWorkspace"
		| "alwaysAllowWrite"
		| "alwaysAllowWriteOutsideWorkspace"
		| "writeDelayMs"
		| "alwaysAllowBrowser"
		| "alwaysApproveResubmit"
		| "requestDelaySeconds"
		| "alwaysAllowMcp"
		| "alwaysAllowModeSwitch"
		| "alwaysAllowSubtasks"
		| "alwaysAllowExecute"
		| "allowedCommands"
	>
}

export const AutoApproveSettings = ({
	alwaysAllowReadOnly,
	alwaysAllowReadOnlyOutsideWorkspace,
	alwaysAllowWrite,
	alwaysAllowWriteOutsideWorkspace,
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
					<span className="codicon codicon-check w-4" />
					<div>{t("settings:sections.autoApprove")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div
					className="flex flex-row gap-2 [@media(min-width:400px)]:gap-4 flex-wrap justify-center"
					style={{
						paddingBottom: "1rem",
						transition: "all 0.2s",
					}}>
					{[
						{
							key: "alwaysAllowReadOnly",
							labelKey: "settings:autoApprove.readOnly.label",
							descriptionKey: "settings:autoApprove.readOnly.description",
							icon: "eye",
							testId: "always-allow-readonly-toggle",
						},
						{
							key: "alwaysAllowWrite",
							labelKey: "settings:autoApprove.write.label",
							descriptionKey: "settings:autoApprove.write.description",
							icon: "edit",
							testId: "always-allow-write-toggle",
						},
						{
							key: "alwaysAllowBrowser",
							labelKey: "settings:autoApprove.browser.label",
							descriptionKey: "settings:autoApprove.browser.description",
							icon: "globe",
							testId: "always-allow-browser-toggle",
						},
						{
							key: "alwaysApproveResubmit",
							labelKey: "settings:autoApprove.retry.label",
							descriptionKey: "settings:autoApprove.retry.description",
							icon: "refresh",
							testId: "always-approve-resubmit-toggle",
						},
						{
							key: "alwaysAllowMcp",
							labelKey: "settings:autoApprove.mcp.label",
							descriptionKey: "settings:autoApprove.mcp.description",
							icon: "plug",
							testId: "always-allow-mcp-toggle",
						},
						{
							key: "alwaysAllowModeSwitch",
							labelKey: "settings:autoApprove.modeSwitch.label",
							descriptionKey: "settings:autoApprove.modeSwitch.description",
							icon: "sync",
							testId: "always-allow-mode-switch-toggle",
						},
						{
							key: "alwaysAllowSubtasks",
							labelKey: "settings:autoApprove.subtasks.label",
							descriptionKey: "settings:autoApprove.subtasks.description",
							icon: "discard",
							testId: "always-allow-subtasks-toggle",
						},
						{
							key: "alwaysAllowExecute",
							labelKey: "settings:autoApprove.execute.label",
							descriptionKey: "settings:autoApprove.execute.description",
							icon: "terminal",
							testId: "always-allow-execute-toggle",
						},
					].map((cfg) => {
						const boolValues = {
							alwaysAllowReadOnly,
							alwaysAllowWrite,
							alwaysAllowBrowser,
							alwaysApproveResubmit,
							alwaysAllowMcp,
							alwaysAllowModeSwitch,
							alwaysAllowSubtasks,
							alwaysAllowExecute,
						}
						const value = boolValues[cfg.key as keyof typeof boolValues] ?? false
						const title = t(cfg.descriptionKey || "")
						return (
							<VSCodeButton
								key={cfg.key}
								appearance={value ? "primary" : "secondary"}
								onClick={() => setCachedStateField(cfg.key as any, !value)}
								title={title}
								data-testid={cfg.testId}
								className="aspect-square min-h-[80px] min-w-[80px]"
								style={{ flexBasis: "20%", transition: "background-color 0.2s" }}>
								<span className="flex flex-col items-center gap-1 h-full">
									<span
										className={`codicon codicon-${cfg.icon}`}
										style={{ fontSize: "1.5rem", paddingTop: "0.5rem" }}
									/>
									<span className="text-sm text-center">{t(cfg.labelKey)}</span>
								</span>
							</VSCodeButton>
						)
					})}
				</div>

				{/* ADDITIONAL SETTINGS */}

				{alwaysAllowReadOnly && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-eye" />
							<div>{t("settings:autoApprove.readOnly.label")}</div>
						</div>
						<div>
							<VSCodeCheckbox
								checked={alwaysAllowReadOnlyOutsideWorkspace}
								onChange={(e: any) =>
									setCachedStateField("alwaysAllowReadOnlyOutsideWorkspace", e.target.checked)
								}
								data-testid="always-allow-readonly-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.readOnly.outsideWorkspace.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.readOnly.outsideWorkspace.description")}
							</div>
						</div>
					</div>
				)}

				{alwaysAllowWrite && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-edit" />
							<div>{t("settings:autoApprove.write.label")}</div>
						</div>
						<div>
							<VSCodeCheckbox
								checked={alwaysAllowWriteOutsideWorkspace}
								onChange={(e: any) =>
									setCachedStateField("alwaysAllowWriteOutsideWorkspace", e.target.checked)
								}
								data-testid="always-allow-write-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.write.outsideWorkspace.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
								{t("settings:autoApprove.write.outsideWorkspace.description")}
							</div>
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={5000}
									step={100}
									value={[writeDelayMs]}
									onValueChange={([value]) => setCachedStateField("writeDelayMs", value)}
									data-testid="write-delay-slider"
								/>
								<span className="w-20">{writeDelayMs}ms</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.write.delayLabel")}
							</div>
						</div>
					</div>
				)}

				{alwaysApproveResubmit && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-refresh" />
							<div>{t("settings:autoApprove.retry.label")}</div>
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={5}
									max={100}
									step={1}
									value={[requestDelaySeconds]}
									onValueChange={([value]) => setCachedStateField("requestDelaySeconds", value)}
									data-testid="request-delay-slider"
								/>
								<span className="w-20">{requestDelaySeconds}s</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.retry.delayLabel")}
							</div>
						</div>
					</div>
				)}

				{alwaysAllowExecute && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-terminal" />
							<div>{t("settings:autoApprove.execute.label")}</div>
						</div>

						<div>
							<label className="block font-medium mb-1" data-testid="allowed-commands-heading">
								{t("settings:autoApprove.execute.allowedCommands")}
							</label>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.execute.allowedCommandsDescription")}
							</div>
						</div>

						<div className="flex gap-2">
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
								className="grow"
								data-testid="command-input"
							/>
							<VSCodeButton onClick={handleAddCommand} data-testid="add-command-button">
								{t("settings:autoApprove.execute.addButton")}
							</VSCodeButton>
						</div>

						<div className="flex flex-wrap gap-2">
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
											const newCommands = (allowedCommands ?? []).filter((_, i) => i !== index)
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
			</Section>
		</div>
	)
}
