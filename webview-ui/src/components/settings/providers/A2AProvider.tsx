import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface A2AProviderProps {
	currentMode: Mode
	isPopup?: boolean
	showModelOptions?: boolean
}

export const A2AProvider = ({ currentMode, isPopup }: A2AProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div style={{ marginBottom: 5 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.a2aAgentCardUrl || ""}
					onChange={(value) => handleFieldChange("a2aAgentCardUrl", value)}
					placeholder="http://example.com:10002/.well-known/agent-card.json"
					style={{ width: "100%" }}>
					<span style={{ fontWeight: 500 }}>Agent Card URL</span>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Enter the full URL to the Agent Card.
				</p>
			</div>

			<div style={{ marginBottom: 5 }}>
				<DebouncedTextField
					initialValue={apiConfiguration?.a2aAuthToken || ""}
					onChange={(value) => handleFieldChange("a2aAuthToken", value)}
					placeholder="Bearer Token"
					style={{ width: "100%" }}
					type="password">
					<span style={{ fontWeight: 500 }}>Auth Token</span>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					(Optional) Bearer token for authentication if required by the agent.
				</p>
			</div>
		</div>
	)
}
