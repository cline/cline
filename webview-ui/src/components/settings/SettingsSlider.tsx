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
		<div className="mt-2 p-3 rounded-md bg-editor-widget-background/30 border border-editor-widget-border/30">
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-0.5 flex-1">
					<Label className="text-xs font-medium text-description">{label}</Label>
				</div>
				<span className={`text-sm font-mono text-foreground ${valueWidth} text-right`}>{value}</span>
			</div>
			<Slider className="mt-2" max={max} min={min} onValueChange={handleSliderChange} step={step} value={[value]} />
			{description && <p className="text-xs text-description mt-2">{description}</p>}
		</div>
	)
}

export default SettingsSlider
