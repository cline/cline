import type { NamedApiBackend } from "@shared/api"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

interface NamedBackendsSectionProps {
	/** True while ApiConfigurationSection is previewing a backend being added/edited. */
	isEditing: boolean
	onDelete: (name: string) => void
	/** Pass null to start adding a brand new backend. */
	onStartEdit: (name: string | null) => void
	onSwitchTo: (backend: NamedApiBackend) => void
}

function backendSummary(config: NamedApiBackend["config"]): string {
	const provider = config.actModeApiProvider ?? config.planModeApiProvider ?? "unknown provider"
	const model = config.actModeApiModelId ?? config.planModeApiModelId
	return model ? `${provider} · ${model}` : provider
}

/**
 * Multichat: a single CRUD list of named backends — the always-present "Current
 * configuration" (the live apiConfiguration, above this list) plus any saved
 * additional backends. Addressing a backend by name in chat — e.g. "Claude
 * Opus, what do you think?" — switches the live provider to it mid-conversation
 * and replays the full conversation (see SdkMultichatCoordinator).
 */
const NamedBackendsSection = ({ isEditing, onDelete, onStartEdit, onSwitchTo }: NamedBackendsSectionProps) => {
	const { defaultBackendName, namedApiBackends } = useExtensionState()
	const backends = namedApiBackends ?? []

	const handleCurrentNameChange = async (value: string) => {
		await StateServiceClient.updateSettings(UpdateSettingsRequest.create({ defaultBackendName: value }))
	}

	return (
		<div className="mb-[5px]">
			<h4 className="mb-1">Multichat backends</h4>
			<p className="text-xs mt-0 mb-[8px] text-(--vscode-descriptionForeground)">
				Name each configuration you want addressable in chat. Saying "&lt;name&gt;, what do you think?" (or just
				"&lt;name&gt; ..." without punctuation) switches the active provider to it mid-conversation.
			</p>

			<div className="flex flex-col gap-[6px]">
				<div className="flex items-center gap-2 px-[10px] py-[6px] rounded-md bg-(--vscode-editor-background) border border-solid border-(--vscode-focusBorder)">
					<span className="text-[10px] uppercase tracking-wide text-(--vscode-descriptionForeground) shrink-0">
						Current
					</span>
					<VSCodeTextField
						className="flex-1"
						disabled={isEditing}
						onInput={(e: any) => handleCurrentNameChange(e.target.value)}
						placeholder="Name this configuration, e.g. ChatGPT"
						value={defaultBackendName ?? ""}
					/>
				</div>

				{backends.map((backend) => (
					<div
						className="flex items-center justify-between gap-2 px-[10px] py-[6px] rounded-md bg-(--vscode-editor-background) border border-solid border-(--vscode-panel-border)"
						key={backend.name}>
						<div className="min-w-0">
							<div className="font-medium truncate">{backend.name}</div>
							<div className="text-xs text-(--vscode-descriptionForeground) truncate">
								{backendSummary(backend.config)}
							</div>
						</div>
						<div className="flex gap-1 shrink-0">
							<VSCodeButton
								appearance="icon"
								disabled={isEditing}
								onClick={() => onSwitchTo(backend)}
								title="Make this the active configuration">
								<span className="codicon codicon-arrow-swap" />
							</VSCodeButton>
							<VSCodeButton
								appearance="icon"
								disabled={isEditing}
								onClick={() => onStartEdit(backend.name)}
								title="Edit">
								<span className="codicon codicon-edit" />
							</VSCodeButton>
							<VSCodeButton
								appearance="icon"
								disabled={isEditing}
								onClick={() => onDelete(backend.name)}
								title="Delete">
								<span className="codicon codicon-trash" />
							</VSCodeButton>
						</div>
					</div>
				))}
			</div>

			<VSCodeButton appearance="secondary" className="mt-[8px]" disabled={isEditing} onClick={() => onStartEdit(null)}>
				+ Add backend
			</VSCodeButton>
		</div>
	)
}

export default NamedBackendsSection
