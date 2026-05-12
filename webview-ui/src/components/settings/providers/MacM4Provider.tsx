/**
 * MacM4Provider settings panel.
 *
 * Renders the configuration UI for the local MacM4LocalAgent stack
 * (https://github.com/martinfr-certifyos/MacM4LocalAgent). MacM4 piggybacks
 * on the LiteLLM storage slot for base URL, API key, and the selected
 * tier id -- the proxy lives at the same loopback address and the auth
 * model is the same, so reusing that slot avoids a parallel set of
 * settings keys and proto fields. The visible difference vs. LiteLlmProvider
 * is the tier list: it is static and comes from macm4Models (mirroring
 * MACM4_TIERS in src/core/api/providers/macm4.ts), which is what gives
 * ContextManager (C3) the correct contextWindow per tier.
 */

import { macm4Models, ModelInfo, type MacM4ModelId } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface MacM4ProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const MacM4Provider = ({ showModelOptions, isPopup, currentMode }: MacM4ProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const handleTierChange = (newTier: MacM4ModelId) => {
		handleModeFieldsChange(
			{
				liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
			},
			{
				liteLlmModelId: newTier,
			},
			currentMode,
		)
	}

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									liteLlmBaseUrl: value,
								},
							},
							updateMask: ["options.liteLlmBaseUrl"],
						}),
					)
				}}
				placeholder="Default: http://127.0.0.1:4000"
				style={{ width: "100%" }}
				type="text">
				<div className="flex items-center gap-2 mb-1">
					<span style={{ fontWeight: 500 }}>Proxy URL (optional)</span>
				</div>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									liteLlmApiKey: value,
								},
							},
							updateMask: ["secrets.liteLlmApiKey"],
						}),
					)
				}}
				placeholder="Default: noop (loopback proxy)"
				style={{ width: "100%" }}
				type="password">
				<div className="flex items-center gap-2 mb-1">
					<span style={{ fontWeight: 500 }}>API Key (optional)</span>
				</div>
			</DebouncedTextField>
			{showModelOptions && (
				<>
					<div className="mt-3 mb-1">
						<span style={{ fontWeight: 500 }}>Tier</span>
					</div>
					<VSCodeDropdown
						onChange={(e) => {
							const target = e.target as HTMLSelectElement
							handleTierChange(target.value as MacM4ModelId)
						}}
						style={{ width: "100%" }}
						value={selectedModelId}>
						{(Object.entries(macm4Models) as Array<[MacM4ModelId, ModelInfo]>).map(([tier, info]) => (
							<VSCodeOption key={tier} value={tier}>
								{tier} -- {info.description ?? ""}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				MacM4LocalAgent is a hybrid local + cloud routing stack for Apple Silicon. local-fast (Qwen2.5-Coder
				on MLX) and local-long (Qwen3-Coder-Next on Ollama) run on-device and are free; the claude-* tiers
				and hybrid-auto route through Anthropic via the proxy. See the{" "}
				<VSCodeLink
					href="https://github.com/martinfr-certifyos/MacM4LocalAgent"
					style={{ display: "inline", fontSize: "inherit" }}>
					MacM4LocalAgent README
				</VSCodeLink>{" "}
				for setup instructions.
			</p>
		</div>
	)
}
