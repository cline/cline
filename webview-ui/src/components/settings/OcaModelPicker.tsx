import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelInfoView } from "./common/ModelInfoView"
import { normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import type { Mode } from "@shared/ChatSettings"
import {
	VSC_FOCUS_BORDER,
	VSC_EDITOR_BACKGROUND,
	VSC_DESCRIPTION_FOREGROUND,
	VSC_FOREGROUND,
	VSC_INPUT_BACKGROUND,
	VSC_BUTTON_BACKGROUND,
	VSC_BUTTON_FOREGROUND,
	VSC_INPUT_FOREGROUND,
} from "@/utils/vscStyles"

export interface OcaModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const OcaModelPicker: React.FC<OcaModelPickerProps> = ({ isPopup, currentMode }: OcaModelPickerProps) => {
	const { apiConfiguration, ocaModels, refreshOcaModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const [pendingModelId, setPendingModelId] = React.useState<string | null>(null)
	const [showRestrictedPopup, setShowRestrictedPopup] = React.useState(false)

	const handleModelChange = async (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it

		if (ocaModels) {
			const bannerContent = ocaModels[newModelId]?.bannerContent
			if (bannerContent) {
				setPendingModelId(newModelId)
				setShowRestrictedPopup(true)
			} else {
				await handleModeFieldsChange(
					{
						ocaLiteLlmModelId: { plan: "planModeOcaLiteLlmModelId", act: "actModeOcaLiteLlmModelId" },
						ocaLiteLlmModelInfo: { plan: "planModeOcaLiteLlmModelInfo", act: "actModeOcaLiteLlmModelInfo" },
					},
					{
						ocaLiteLlmModelId: newModelId,
						ocaLiteLlmModelInfo: ocaModels[newModelId],
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
					ocaLiteLlmModelId: { plan: "planModeOcaLiteLlmModelId", act: "actModeOcaLiteLlmModelId" },
					ocaLiteLlmModelInfo: { plan: "planModeOcaLiteLlmModelInfo", act: "actModeOcaLiteLlmModelInfo" },
				},
				{
					ocaLiteLlmModelId: pendingModelId,
					ocaLiteLlmModelInfo: ocaModels[pendingModelId],
				},
				currentMode,
			)
			setPendingModelId(null)
			setShowRestrictedPopup(false)
		}
	}

	const handleRefreshToken = async () => {
		await refreshOcaModels(apiConfiguration?.ocaLiteLlmBaseUrl || "")
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration])

	useMount(() => {
		refreshOcaModels(apiConfiguration?.ocaLiteLlmBaseUrl || "")
	})

	const modelIds = useMemo(() => {
		return Object.keys(ocaModels || []).sort((a, b) => a.localeCompare(b))
	}, [ocaModels])

	const showBudgetSlider = useMemo(() => {
		if (ocaModels && selectedModelId && ocaModels[selectedModelId]?.thinkingConfig) {
			return true
		}
	}, [selectedModelId])

	return (
		<div style={{ width: "100%" }}>
			{showRestrictedPopup && (
				<OcaRestrictivePopup
					onAcknowledge={onAcknowledge}
					bannerText={ocaModels && pendingModelId && ocaModels[pendingModelId]?.bannerContent}
				/>
			)}
			<label
				style={{
					fontWeight: 500,
					fontSize: 12,
					margin: "10px 0 2px 0",
				}}>
				Model
			</label>
			<VSCodeDropdown
				id="model-id"
				value={selectedModelId || ""}
				onChange={async (event: Event | React.FormEvent<HTMLElement>) => {
					const target = event.target as HTMLSelectElement | null
					const value = target?.value ?? ""
					await handleModelChange(value)
				}}
				style={{ width: "100%", fontSize: 13, minHeight: 27 }}>
				{modelIds?.map((modelId) => (
					<VSCodeOption
						key={modelId}
						value={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
							fontSize: 13,
						}}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			<VSCodeButton
				style={{
					fontSize: 14,
					borderRadius: 22,
					fontWeight: 500,
					background: "var(--vscode-button-background, #0078d4)",
					color: "var(--vscode-button-foreground, #fff)",
					minWidth: 0,
					margin: "12px 0",
				}}
				onClick={handleRefreshToken}>
				Refresh
			</VSCodeButton>
			{selectedModelInfo && (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}
					<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
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
	<div
		style={{
			position: "fixed",
			top: 0,
			left: 0,
			width: "100vw",
			height: "100vh",
			zIndex: 2000,
			background: "rgba(0,0,0,0.25)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		}}>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="oca-popup-title"
			style={{
				padding: 24,
				maxWidth: 600,
				width: "90%",
				borderRadius: 8,
				boxShadow: `0 4px 24px 0 var(--vscode-widget-shadow,rgba(0,0,0,.4))`,
				border: `1px solid var(${VSC_FOCUS_BORDER}, #007acc)`,
				background: `var(${VSC_EDITOR_BACKGROUND}, #252526)`,
				color: `var(${VSC_FOREGROUND}, #cccccc)`,
				fontFamily: "var(--vscode-font-family, sans-serif)",
				fontSize: "var(--vscode-font-size, 13px)",
				display: "flex",
				flexDirection: "column",
				maxHeight: "80vh",
			}}>
			<h2
				id="oca-popup-title"
				style={{
					marginTop: 0,
					color: `var(${VSC_FOREGROUND}, #111)`,
					fontWeight: "bold",
				}}>
				Acknowledgement Required
			</h2>
			<h4
				style={{
					marginBottom: 8,
					color: `var(${VSC_DESCRIPTION_FOREGROUND}, #b3b3b3)`,
					fontWeight: 600,
				}}>
				Disclaimer: Prohibited Data Submission
			</h4>
			<div
				style={{
					overflowY: "auto",
					flex: 1,
					paddingRight: 8,
					marginBottom: 16,
					fontSize: 13,
					lineHeight: 1.5,
					color: `var(${VSC_FOREGROUND}, #222)`,
					maskImage: "linear-gradient(to bottom, black 96%, transparent 100%)",
				}}>
				{bannerText && (
					<div
						style={{
							wordBreak: "break-word",
							background: `var(${VSC_INPUT_BACKGROUND}, #252526)`,
							color: `var(${VSC_FOREGROUND}, #222)`,
						}}
						dangerouslySetInnerHTML={{ __html: bannerText }}
					/>
				)}
			</div>
			<div style={{ textAlign: "right" }}>
				<VSCodeButton
					type="button"
					onClick={onAcknowledge}
					style={{
						background: `var(${VSC_BUTTON_BACKGROUND}, #0e639c)`,
						color: `var(${VSC_BUTTON_FOREGROUND}, #fff)`,
					}}>
					I acknowledge and agree
				</VSCodeButton>
			</div>
		</div>
	</div>
))
