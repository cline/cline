import { isOpenaiReasoningEffort, Mode, OPENAI_REASONING_EFFORT_OPTIONS, OpenaiReasoningEffort } from "@shared/storage/types"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	defaultEffort?: OpenaiReasoningEffort
	/** Optional callback invoked after the effort value changes. Use to persist to provider-specific stores. */
	onEffortChange?: (effort: OpenaiReasoningEffort) => void
}

// Known effort values get localized display names; unknown values fall back to
// a capitalized form of the raw value.
const EFFORT_LABEL_KEYS: Partial<Record<string, string>> = {
	high: "settings:reasoningEffort.options.high",
	low: "settings:reasoningEffort.options.low",
	medium: "settings:reasoningEffort.options.medium",
	none: "settings:reasoningEffort.options.none",
	xhigh: "settings:reasoningEffort.options.xhigh",
}

const ReasoningEffortSelector = ({
	currentMode,
	label,
	description,
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = "medium",
	onEffortChange,
}: ReasoningEffortSelectorProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedEffort =
		isOpenaiReasoningEffort(modeFields.reasoningEffort) && allowedEfforts.includes(modeFields.reasoningEffort)
			? modeFields.reasoningEffort
			: defaultEffort

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label ?? t("settings:reasoningEffort.label")}</Label>
			<Select
				onValueChange={(value) => {
					handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, value, currentMode)
					if (onEffortChange && isOpenaiReasoningEffort(value)) {
						onEffortChange(value)
					}
				}}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{allowedEfforts.map((effort) => {
						const labelKey = EFFORT_LABEL_KEYS[effort]
						return (
							<SelectItem key={effort} value={effort}>
								{labelKey ? t(labelKey) : effort.charAt(0).toUpperCase() + effort.slice(1)}
							</SelectItem>
						)
					})}
				</SelectContent>
			</Select>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description ?? t("settings:reasoningEffort.description")}
			</p>
		</div>
	)
}

export default memo(ReasoningEffortSelector)
