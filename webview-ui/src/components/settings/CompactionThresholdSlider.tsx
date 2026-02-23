import { Mode } from "@shared/storage/types"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import SettingsSlider from "./SettingsSlider"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

const COMPACTION_THRESHOLD_MAX = 1_000_000
const COMPACTION_THRESHOLD_MIN = 50_000
const COMPACTION_THRESHOLD_STEP = 50_000

function formatCompactionThreshold(value: number): string {
	if (value >= COMPACTION_THRESHOLD_MAX) {
		return "Default"
	}
	return `${Math.round(value / 1000)}K tokens`
}

interface CompactionThresholdSliderProps {
	currentMode: Mode
}

const CompactionThresholdSlider = ({ currentMode }: CompactionThresholdSliderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [localValue, setLocalValue] = useState(modeFields.autoCondenseTokenLimit ?? COMPACTION_THRESHOLD_MAX)

	useEffect(() => {
		const newValue = modeFields.autoCondenseTokenLimit ?? COMPACTION_THRESHOLD_MAX
		if (newValue !== localValue) {
			setLocalValue(newValue)
		}
	}, [modeFields.autoCondenseTokenLimit])

	const handleChange = useCallback(
		(sliderValue: number) => {
			setLocalValue(sliderValue)
			// A value at or above max means "no custom limit" (use default)
			const valueToSave = sliderValue >= COMPACTION_THRESHOLD_MAX ? undefined : sliderValue
			handleModeFieldChange(
				{ plan: "planModeAutoCondenseTokenLimit", act: "actModeAutoCondenseTokenLimit" },
				valueToSave as any,
				currentMode,
			)
		},
		[handleModeFieldChange, currentMode],
	)

	return (
		<SettingsSlider
			description="Set a custom token limit for when context is compacted. Drag left to compact earlier. Drag to Default to use the model's natural limit."
			formatValue={formatCompactionThreshold}
			label="Compaction threshold (experimental)"
			max={COMPACTION_THRESHOLD_MAX}
			min={COMPACTION_THRESHOLD_MIN}
			onChange={handleChange}
			step={COMPACTION_THRESHOLD_STEP}
			value={localValue}
			valueWidth="w-24"
		/>
	)
}

export default memo(CompactionThresholdSlider)
