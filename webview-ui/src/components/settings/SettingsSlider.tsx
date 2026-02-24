import React from "react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

interface SettingsSliderProps {
	label: string
	min: number
	max: number
	step: number
	value: number
	onChange: (value: number) => void
	description?: string
	/** Width of the value display span (default: w-12) */
	valueWidth?: string
}

const SettingsSlider: React.FC<SettingsSliderProps> = ({
	label,
	min,
	max,
	step,
	value,
	onChange,
	description,
	valueWidth = "w-12",
}) => {
	const handleSliderChange = (values: number[]) => {
		onChange(values[0])
	}

	return (
		<div>
			<div className="flex items-center justify-between gap-4">
				<Label className="space-y-0.5 flex-1 text-xs text-description">{label}</Label>
				<span className={`text-sm font-mono text-foreground ${valueWidth} text-right`}>{value}</span>
			</div>
			<Slider className="mt-2" max={max} min={min} onValueChange={handleSliderChange} step={step} value={[value]} />
			{description && <p className="text-xs text-description mt-2">{description}</p>}
		</div>
	)
}

export default SettingsSlider
