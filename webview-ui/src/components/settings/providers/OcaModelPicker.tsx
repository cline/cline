import type { OcaModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	VSC_BUTTON_BACKGROUND,
	VSC_BUTTON_FOREGROUND,
	VSC_DESCRIPTION_FOREGROUND,
	VSC_FOREGROUND,
	VSC_INPUT_BACKGROUND,
} from "@/utils/vscStyles"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

export interface OcaModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	ocaModels: Record<string, OcaModelInfo>
	onRefresh: () => void | Promise<void>
}

const OcaModelPicker: React.FC<OcaModelPickerProps> = ({ isPopup, currentMode, ocaModels, onRefresh }: OcaModelPickerProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [pendingModelId, setPendingModelId] = React.useState<string | null>(null)
	const [showRestrictedPopup, setShowRestrictedPopup] = React.useState(false)

	const handleModelChange = async (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it

		if (ocaModels) {
			const banner = ocaModels[newModelId]?.banner
			if (banner) {
				setPendingModelId(newModelId)
				setShowRestrictedPopup(true)
			} else {
				await handleModeFieldsChange(
					{
						ocaModelId: { plan: "planModeOcaModelId", act: "actModeOcaModelId" },
						ocaModelInfo: { plan: "planModeOcaModelInfo", act: "actModeOcaModelInfo" },
					},
					{
						ocaModelId: newModelId,
						ocaModelInfo: ocaModels[newModelId],
					},
					currentMode,
				)
			}
		}
	}

	const onAcknowledge = async () => {
		if (pendingModelId && ocaModels) {
			await handleModeFieldsChange(
				{
					ocaModelId: { plan: "planModeOcaModelId", act: "actModeOcaModelId" },
					ocaModelInfo: { plan: "planModeOcaModelInfo", act: "actModeOcaModelInfo" },
				},
				{
					ocaModelId: pendingModelId,
					ocaModelInfo: ocaModels[pendingModelId],
				},
				currentMode,
			)
			setPendingModelId(null)
			setShowRestrictedPopup(false)
		}
	}

	const handleRefreshToken = async () => {
		await onRefresh?.()
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration])

	const modelIds = useMemo(() => {
		return Object.keys(ocaModels || []).sort((a, b) => a.localeCompare(b))
	}, [ocaModels])

	const showBudgetSlider = useMemo(() => {
		if (ocaModels && selectedModelId && ocaModels[selectedModelId]?.thinkingConfig) {
			return true
		}
	}, [selectedModelId, ocaModels])

	return (
		<div className="w-full">
			{showRestrictedPopup && (
				<OcaRestrictivePopup
					bannerText={ocaModels && pendingModelId && ocaModels[pendingModelId]?.banner}
					onAcknowledge={onAcknowledge}
				/>
			)}
			<label className="font-medium text-[12px] mt-[10px] mb-[2px]">Model</label>
			<VSCodeDropdown
				className="w-full text-[13px] min-h-[27px]"
				id="model-id"
				onChange={async (event: Event | React.FormEvent<HTMLElement>) => {
					const target = event.target as HTMLSelectElement | null
					const value = target?.value ?? ""
					await handleModelChange(value)
				}}
				value={selectedModelId || ""}>
				{modelIds?.map((modelId) => (
					<VSCodeOption
						key={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
							fontSize: 13,
						}}
						value={modelId}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			<VSCodeButton
				onClick={handleRefreshToken}
				style={{
					fontSize: 14,
					borderRadius: 22,
					fontWeight: 500,
					background: "var(--vscode-button-background, #0078d4)",
					color: "var(--vscode-button-foreground, #fff)",
					minWidth: 0,
					margin: "12px 0",
				}}>
				Refresh
			</VSCodeButton>
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

const OcaRestrictivePopup: React.FC<{
	onAcknowledge: () => void
	bannerText?: string | null
}> = React.memo(({ onAcknowledge, bannerText }) => (
	<div className="fixed top-0 left-0 w-screen h-screen z-[2000] [background:rgba(0,0,0,0.25)] flex items-center justify-center">
		<div
			aria-labelledby="oca-popup-title"
			aria-modal="true"
			className={`p-6 max-w-[600px] w-[90%] rounded-[8px] [box-shadow:0_4px_24px_0_var(--vscode-widget-shadow,rgba(0,0,0,.4))] [border:1px_solid_var(--vscode-focusBorder,#007acc)] [background:var(--vscode-editor-background,#252526)] [color:var(${VSC_FOREGROUND},#cccccc)] [font-family:var(--vscode-font-family,sans-serif)] [font-size:var(--vscode-font-size,13px)] flex flex-col max-h-[80vh]`}
			role="dialog">
			<h2 className={`mt-0 [color:var(${VSC_FOREGROUND},#111)] font-bold`} id="oca-popup-title">
				Acknowledgement Required
			</h2>
			<h4 className={`mb-2 [color:var(${VSC_DESCRIPTION_FOREGROUND},#b3b3b3)] font-semibold`}>
				Disclaimer: Prohibited Data Submission
			</h4>
			<div className="overflow-y-auto flex-1 pr-2 mb-4 text-[13px] leading-[1.5] [color:var(--vscode-foreground,#222)] [mask-image:linear-gradient(to_bottom,black_96%,transparent_100%)]">
				{bannerText && (
					<div
						className={`break-words [background:var(${VSC_INPUT_BACKGROUND},#252526)] [color:var(${VSC_FOREGROUND},#222)]`}
						dangerouslySetInnerHTML={{ __html: bannerText }}
					/>
				)}
			</div>
			<div className="text-right">
				<VSCodeButton
					onClick={onAcknowledge}
					style={{
						background: `var(${VSC_BUTTON_BACKGROUND}, #0e639c)`,
						color: `var(${VSC_BUTTON_FOREGROUND}, #fff)`,
					}}
					type="button">
					I acknowledge and agree
				</VSCodeButton>
			</div>
		</div>
	</div>
))
