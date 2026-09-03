import { UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/index.cline"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { StateServiceClient } from "../../../services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const {
		shellIntegrationTimeout,
		terminalReuseEnabled,
		defaultTerminalProfile,
		availableTerminalProfiles,
		vscodeTerminalExecutionMode,
	} = useExtensionState()
	const { t } = useTranslation()
	const platformConfig = usePlatform()
	const isVsCodePlatform = platformConfig.type === PlatformType.VSCODE
	const executionMode = vscodeTerminalExecutionMode ?? "vscodeTerminal"
	const isBackgroundExec = executionMode === "backgroundExec"

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value

		setInputValue(value)

		const seconds = Number.parseFloat(value)
		if (Number.isNaN(seconds) || seconds <= 0) {
			setInputError(t("settings:terminal.shellTimeout.invalidNumber"))
			return
		}

		setInputError(null)
		const timeoutMs = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				const timeoutMs = response.timeoutMs
				// Backend calls postStateToWebview(), so state will update via subscription
				// Just sync the input value with the confirmed backend value
				if (timeoutMs !== undefined) {
					setInputValue((timeoutMs / 1000).toString())
				}
			})
			.catch((error) => {
				console.error("Failed to update terminal connection timeout:", error)
			})
	}

	const handleInputBlur = () => {
		if (inputError) {
			setInputValue((shellIntegrationTimeout / 1000).toString())
			setInputError(null)
		}
	}

	const handleTerminalReuseChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const checked = target.checked
		updateSetting("terminalReuseEnabled", checked)
	}

	const handleExecutionModeChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const value = target.value === "backgroundExec" ? "backgroundExec" : "vscodeTerminal"
		updateSetting("vscodeTerminalExecutionMode", value)
	}

	// Use any to avoid type conflicts between Event and FormEvent
	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		const profileId = target.value

		// Save immediately using the consolidated updateSettings approach
		updateSetting("defaultTerminalProfile", profileId || "default")
	}

	const profilesToShow = availableTerminalProfiles

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section>
				<div className="mb-5" id="terminal-settings-section">
					{isVsCodePlatform && (
						<div className="mb-4">
							<label className="font-medium block mb-1" htmlFor="terminal-execution-mode">
								{t("settings:terminal.executionMode.label")}
							</label>
							<VSCodeDropdown
								className="w-full"
								id="terminal-execution-mode"
								onChange={(event) => handleExecutionModeChange(event as Event)}
								value={executionMode}>
								<VSCodeOption value="vscodeTerminal">
									{t("settings:terminal.executionMode.vscodeTerminal")}
								</VSCodeOption>
								<VSCodeOption value="backgroundExec">
									{t("settings:terminal.executionMode.backgroundExec")}
								</VSCodeOption>
							</VSCodeDropdown>
							<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
								{t("settings:terminal.executionMode.description")}
							</p>
						</div>
					)}

					{isVsCodePlatform && !isBackgroundExec && (
						<>
							<div className="mb-4">
								<div className="mb-2">
									<label className="font-medium block mb-1">{t("settings:terminal.shellTimeout.label")}</label>
									<div className="flex items-center">
										<VSCodeTextField
											className="w-full"
											onBlur={handleInputBlur}
											onChange={(event) => handleTimeoutChange(event as Event)}
											placeholder={t("settings:terminal.shellTimeout.placeholder")}
											value={inputValue}
										/>
									</div>
									{inputError && (
										<div className="text-(--vscode-errorForeground) text-xs mt-1">{inputError}</div>
									)}
								</div>
								<p className="text-xs text-(--vscode-descriptionForeground)">
									{t("settings:terminal.shellTimeout.description")}
								</p>
							</div>

							<div className="mb-4">
								<div className="flex items-center mb-2">
									<VSCodeCheckbox
										checked={terminalReuseEnabled ?? true}
										onChange={(event) => handleTerminalReuseChange(event as Event)}>
										{t("settings:terminal.reuse.label")}
									</VSCodeCheckbox>
								</div>
								<p className="text-xs text-(--vscode-descriptionForeground)">
									{t("settings:terminal.reuse.description")}
								</p>
							</div>
						</>
					)}

					{/* Terminal choice affects both foreground and background execution mode. */}
					<div className="mb-4">
						<label className="font-medium block mb-1" htmlFor="default-terminal-profile">
							{t("settings:terminal.defaultProfile.label")}
						</label>
						<VSCodeDropdown
							className="w-full"
							id="default-terminal-profile"
							onChange={handleDefaultTerminalProfileChange}
							value={defaultTerminalProfile || "default"}>
							{profilesToShow.map((profile) => (
								<VSCodeOption key={profile.id} title={profile.description} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-xs text-(--vscode-descriptionForeground) mt-1">
							{t("settings:terminal.defaultProfile.description")}
						</p>
					</div>
					<div className="mt-5 p-3 bg-(--vscode-textBlockQuote-background) rounded border border-(--vscode-textBlockQuote-border)">
						<p className="text-[13px] m-0">
							<Trans
								components={{
									guideLink: (
										// biome-ignore lint/a11y/useAnchorContent: content is injected by Trans
										<a
											className="text-(--vscode-textLink-foreground) underline hover:no-underline"
											href="https://docs.cline.bot/troubleshooting/terminal-integration-guide"
											rel="noopener noreferrer"
											target="_blank"
										/>
									),
									quickFixesLink: (
										// biome-ignore lint/a11y/useAnchorContent: content is injected by Trans
										<a
											className="text-(--vscode-textLink-foreground) underline hover:no-underline"
											href="https://docs.cline.bot/troubleshooting/terminal-quick-fixes"
											rel="noopener noreferrer"
											target="_blank"
										/>
									),
									strong: <strong />,
								}}
								i18nKey="settings:terminal.troubleshooting.text"
							/>
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default TerminalSettingsSection
