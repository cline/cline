import React from "react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const SubagentOutputLineLimitSlider: React.FC = () => {
	const { subagentTerminalOutputLineLimit } = useExtensionState()

	const handleSliderChange = (value: number[]) => {
		updateSetting("subagentTerminalOutputLineLimit", value[0])
	}

	return (
		<div className="mt-2 p-3 rounded-md bg-editor-widget-background/30 border border-editor-widget-border/30">
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-0.5 flex-1">
					<Label className="text-xs font-medium text-description">Output Limit (100-5000)</Label>
				</div>
				<span className="text-sm font-mono text-foreground w-12 text-right">
					{subagentTerminalOutputLineLimit ?? 2000}
				</span>
			</div>
			<Slider
				className="mt-2"
				max={5000}
				min={100}
				onValueChange={handleSliderChange}
				step={100}
				value={[subagentTerminalOutputLineLimit ?? 2000]}
			/>
			<p className="text-xs text-description mt-2">
				Maximum number of lines to include in output from CLI subagents. Truncates middle to save tokens.
			</p>
		</div>
	)
}

export default SubagentOutputLineLimitSlider
