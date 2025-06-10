import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { UpdateSettingsRequest } from "@shared/proto/state"

const TerminalOutputLineLimitSlider: React.FC = () => {
	const { terminalOutputLineLimit, setTerminalOutputLineLimit, ...state } = useExtensionState()

	const handleSliderChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		setTerminalOutputLineLimit(value)

		// Import the conversion functions
		const { convertApiConfigurationToProtoApiConfiguration } = await import(
			"@shared/proto-conversions/state/settings-conversion"
		)
		const { convertChatSettingsToProtoChatSettings } = await import(
			"@shared/proto-conversions/state/chat-settings-conversion"
		)

		StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				terminalOutputLineLimit: value,
				apiConfiguration: state.apiConfiguration
					? convertApiConfigurationToProtoApiConfiguration(state.apiConfiguration)
					: undefined,
				customInstructionsSetting: state.customInstructions,
				telemetrySetting: state.telemetrySetting,
				planActSeparateModelsSetting: state.planActSeparateModelsSetting,
				enableCheckpointsSetting: state.enableCheckpointsSetting,
				mcpMarketplaceEnabled: state.mcpMarketplaceEnabled,
				chatSettings: state.chatSettings ? convertChatSettingsToProtoChatSettings(state.chatSettings) : undefined,
				shellIntegrationTimeout: state.shellIntegrationTimeout,
				terminalReuseEnabled: state.terminalReuseEnabled,
				mcpResponsesCollapsed: state.mcpResponsesCollapsed,
			}),
		)
	}

	return (
		<div style={{ marginBottom: 15 }}>
			<label htmlFor="terminal-output-limit" style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
				Terminal output limit
			</label>
			<div style={{ display: "flex", alignItems: "center" }}>
				<input
					type="range"
					id="terminal-output-limit"
					min="50"
					max="2000"
					step="50"
					value={terminalOutputLineLimit ?? 500}
					onChange={handleSliderChange}
					style={{ flexGrow: 1, marginRight: "1rem" }}
				/>
				<span>{terminalOutputLineLimit ?? 500}</span>
			</div>
			<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "5px 0 0 0" }}>
				Maximum number of lines to include in terminal output when executing commands. When exceeded, lines will be
				removed from the middle, saving tokens.
			</p>
		</div>
	)
}

export default TerminalOutputLineLimitSlider
