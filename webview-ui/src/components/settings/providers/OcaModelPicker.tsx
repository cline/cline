import type { ApiConfiguration, OcaModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import { VSC_BUTTON_BACKGROUND, VSC_BUTTON_FOREGROUND, VSC_DESCRIPTION_FOREGROUND, VSC_FOREGROUND } from "@/utils/vscStyles"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

export interface OcaModelPickerProps {
	apiConfiguration: ApiConfiguration | undefined
	isPopup?: boolean
	currentMode: Mode
	ocaModels: Record<string, OcaModelInfo>
	onRefresh: () => void | Promise<void>
	loading?: boolean
	lastRefreshedAt?: number | null
}

const OcaModelPicker: React.FC<OcaModelPickerProps> = ({
	apiConfiguration,
	isPopup,
	currentMode,
	ocaModels,
	onRefresh,
	loading,
	lastRefreshedAt,
}: OcaModelPickerProps) => {
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
	}, [apiConfiguration, currentMode])

	const modelIds = useMemo(() => {
		return Object.keys(ocaModels || []).sort((a, b) => a.localeCompare(b))
	}, [ocaModels])

	const showBudgetSlider = useMemo(() => {
		if (ocaModels && selectedModelId && ocaModels[selectedModelId]?.thinkingConfig) {
			return true
		}
	}, [selectedModelId, ocaModels])

	const lastRefreshedText = useMemo(() => {
		return typeof lastRefreshedAt === "number" ? new Date(lastRefreshedAt).toLocaleTimeString() : null
	}, [lastRefreshedAt])

	return (
		<div className="w-full">
			{showRestrictedPopup && (
				<OcaRestrictivePopup
					bannerText={ocaModels && pendingModelId && ocaModels[pendingModelId]?.banner}
					onAcknowledge={onAcknowledge}
				/>
			)}
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
					onChange={async (event: Event | React.FormEvent<HTMLElement>) => {
						const target = event.target as HTMLSelectElement | null
						const value = target?.value ?? ""
						await handleModelChange(value)
					}}
					style={{ position: "relative", zIndex: 100 }}
					value={selectedModelId || ""}>
					{modelIds?.map((modelId) => (
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
					disabled={!!loading}
					onClick={handleRefreshToken}
					style={{
						fontSize: 14,
						fontWeight: 500,
						background: "var(--vscode-button-background, #0078d4)",
						color: "var(--vscode-button-foreground, #fff)",
						minWidth: 0,
						margin: 0,
					}}>
					{loading ? "Refreshing…" : "Refresh"}
				</VSCodeButton>
			</div>
			{lastRefreshedText ? (
				<div className="text-[11px] text-(--vscode-descriptionForeground) mt-0 mb-2">
					Last refreshed at {lastRefreshedText}
				</div>
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

const OcaRestrictivePopup: React.FC<{
	onAcknowledge: () => void
	bannerText?: string | null
}> = React.memo(({ onAcknowledge, bannerText }) => (
	<div className="fixed top-0 left-0 w-screen h-screen z-2000 [background:rgba(0,0,0,0.25)] flex items-center justify-center">
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
			<div className="overflow-y-auto flex-1 pr-2 mb-4 text-[13px] leading-normal text-(--vscode-foreground,#222) mask-[linear-gradient(to_bottom,black_96%,transparent_100%)]">
				{bannerText && <div dangerouslySetInnerHTML={{ __html: bannerText }} />}
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
