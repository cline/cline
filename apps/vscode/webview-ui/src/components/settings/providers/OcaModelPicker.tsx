import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

interface OcaModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const OcaModelPicker = ({ isPopup, currentMode }: OcaModelPickerProps) => {
	const providerId = "oca" as ProviderId
	const { models, defaultModelId, isLoading, error, refresh } = useProviderModels(providerId)
	const { config, commitSelection } = useProviderConfig(providerId)
	const { selectedModelId, selectedModelInfo, commitModelSelection } = useProviderModelSelection(providerId, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
		allowsCustomIds: false,
	})

	const modelIds = useMemo(() => Object.keys(models).sort((a, b) => a.localeCompare(b)), [models])
	const showBudgetSlider = Boolean(selectedModelInfo?.thinkingConfig)

	const handleModelChange = async (event: any) => {
		const value = (event.target as HTMLSelectElement | null)?.value ?? ""
		const modelInfo = models[value]
		if (!value || !modelInfo) {
			return
		}
		await commitModelSelection({ modelId: value, modelInfo })
	}

	return (
		<div className="w-full">
			<style>{`
				#model-id::part(listbox){
					max-height: 100px;
					overflow: auto;
				}
			`}</style>
			<label className="font-medium text-[12px] mt-[10px] mb-[2px]">Model</label>
			<div className="relative z-100 flex items-center gap-2 mb-1">
				<VSCodeDropdown
					className="flex-1 text-[12px] min-h-[24px]"
					id="model-id"
					onChange={handleModelChange}
					style={{ position: "relative", zIndex: 100 }}
					value={selectedModelId || ""}>
					{modelIds.map((modelId) => (
						<VSCodeOption
							key={modelId}
							style={{
								padding: "4px 8px",
								cursor: "pointer",
								wordWrap: "break-word",
								maxWidth: "100%",
								fontSize: 12,
							}}
							value={modelId}>
							{modelId}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<VSCodeButton
					disabled={isLoading}
					onClick={() => void refresh()}
					style={{
						fontSize: 14,
						fontWeight: 500,
						background: "var(--vscode-button-background, #0078d4)",
						color: "var(--vscode-button-foreground, #fff)",
						minWidth: 0,
						margin: 0,
					}}>
					{isLoading ? "Refreshing..." : "Refresh"}
				</VSCodeButton>
			</div>
			{error ? (
				<div className="text-[11px] text-(--vscode-descriptionForeground) mt-0 mb-2">Failed to refresh models.</div>
			) : null}
			{selectedModelInfo && (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

export default OcaModelPicker
