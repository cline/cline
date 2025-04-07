import React, { useCallback } from "react"
import { Slider } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface RateLimitSecondsControlProps {
	value: number
	onChange: (value: number) => void
}

export const RateLimitSecondsControl: React.FC<RateLimitSecondsControlProps> = ({ value, onChange }) => {
	const { t } = useAppTranslation()

	const handleValueChange = useCallback(
		(newValue: number) => {
			onChange(newValue)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.rateLimitSeconds.label")}</label>
			<div className="flex items-center gap-2">
				<Slider
					value={[value]}
					min={0}
					max={60}
					step={1}
					onValueChange={(newValue) => handleValueChange(newValue[0])}
				/>
				<span className="w-10">{value}s</span>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.rateLimitSeconds.description", { value })}
			</div>
		</div>
	)
}
