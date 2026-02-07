import { Mode, OpenaiReasoningEffort } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: OpenaiReasoningEffort[]
}

const DEFAULT_EFFORTS: OpenaiReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"]

const ReasoningEffortSelector = ({
	currentMode,
	label = "Reasoning Effort",
	description = "Higher effort improves depth, but uses more tokens.",
	allowedEfforts = DEFAULT_EFFORTS,
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedEffort = allowedEfforts.includes(modeFields.reasoningEffort as OpenaiReasoningEffort)
		? (modeFields.reasoningEffort as OpenaiReasoningEffort)
		: "medium"

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				onValueChange={(value) =>
					handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, value, currentMode)
				}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{allowedEfforts.map((effort) => (
						<SelectItem key={effort} value={effort}>
							{effort.charAt(0).toUpperCase() + effort.slice(1)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description}
			</p>
		</div>
	)
}

export default memo(ReasoningEffortSelector)
