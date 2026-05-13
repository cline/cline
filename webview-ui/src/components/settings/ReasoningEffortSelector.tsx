import { isOpenaiReasoningEffort, Mode, OPENAI_REASONING_EFFORT_OPTIONS, OpenaiReasoningEffort } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	defaultEffort?: OpenaiReasoningEffort
}

const ReasoningEffortSelector = ({
	currentMode,
	label = "Reasoning Effort",
	description = "Higher effort improves depth, but uses more tokens.",
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = "medium",
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeConfig = currentMode === "plan" ? apiConfiguration?.planConfig : apiConfiguration?.actConfig
	const selectedEffort =
		isOpenaiReasoningEffort(modeConfig?.reasoningEffort) && allowedEfforts.includes(modeConfig?.reasoningEffort)
			? modeConfig?.reasoningEffort
			: defaultEffort

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				onValueChange={(value) =>
					handleModeFieldChange("reasoningEffort", value, currentMode)
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
