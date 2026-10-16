import { isOpenaiReasoningEffort, Mode, OPENAI_REASONING_EFFORT_OPTIONS, OpenaiReasoningEffort } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { DEFAULT_REASONING_EFFORT_OPTION, type ReasoningEffortSelection } from "./utils/reasoningEffort"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	/** Shown when nothing is saved. Ignored when `value` is passed. */
	defaultEffort?: OpenaiReasoningEffort
	/**
	 * The provider's saved effort, for providers that persist reasoning in their
	 * own settings. When passed, it is what the selector shows, and a "Default"
	 * entry stands for nothing saved, so every listed level is a real change.
	 * `null` means the saved effort is still loading: the selector shows no
	 * level and is disabled, since a pick could match a stale display.
	 */
	value?: ReasoningEffortSelection | null
	/** Optional callback invoked after the effort value changes. Use to persist to provider-specific stores. */
	onEffortChange?: (effort: ReasoningEffortSelection) => void
}

const ReasoningEffortSelector = ({
	currentMode,
	label = "Reasoning Effort",
	description = "Higher effort improves depth, but uses more tokens.",
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = "medium",
	value,
	onEffortChange,
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const options: readonly ReasoningEffortSelection[] =
		value === undefined ? allowedEfforts : [DEFAULT_REASONING_EFFORT_OPTION, ...allowedEfforts]
	const isLoading = value === null
	const selectedEffort =
		value === null
			? ""
			: value !== undefined
				? options.includes(value)
					? value
					: DEFAULT_REASONING_EFFORT_OPTION
				: isOpenaiReasoningEffort(modeFields.reasoningEffort) && allowedEfforts.includes(modeFields.reasoningEffort)
					? modeFields.reasoningEffort
					: defaultEffort

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				disabled={isLoading}
				onValueChange={(next) => {
					if (isOpenaiReasoningEffort(next)) {
						handleModeFieldChange(
							{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
							next,
							currentMode,
						)
					}
					if (onEffortChange && (isOpenaiReasoningEffort(next) || next === DEFAULT_REASONING_EFFORT_OPTION)) {
						onEffortChange(next)
					}
				}}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((effort) => (
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
