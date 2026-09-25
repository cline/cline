import React, { useEffect, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
	type AppDirection,
	isAppDirection,
	type ResolvedDirection,
	readAppliedDirection,
	readStoredDirection,
	setStoredDirection,
	subscribeToDirection,
} from "@/utils/direction"

const directionOptions: { value: AppDirection; label: string }[] = [
	{ value: "auto", label: "Auto (match system language)" },
	{ value: "ltr", label: "Left to right" },
	{ value: "rtl", label: "Right to left" },
]

const DirectionSetting: React.FC = () => {
	const [direction, setDirection] = useState<AppDirection>(() => readStoredDirection())
	const [appliedDirection, setAppliedDirection] = useState<ResolvedDirection>(() => readAppliedDirection())

	useEffect(() => subscribeToDirection(setAppliedDirection), [])

	// Applying immediately is what makes this instant: the preference lives in
	// the webview, so there is nothing to round-trip to the host.
	const updateDirection = (nextDirection: string) => {
		if (!isAppDirection(nextDirection)) {
			return
		}
		setStoredDirection(nextDirection)
		setDirection(nextDirection)
	}

	return (
		<div>
			<label className="block mb-1 text-base font-medium" htmlFor="text-direction-dropdown">
				Text Direction
			</label>
			<Select onValueChange={updateDirection} value={direction}>
				<SelectTrigger className="w-full" id="text-direction-dropdown">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{directionOptions.map(({ value, label }) => (
						<SelectItem key={value} value={value}>
							{label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-description mt-1">
				Mirror the interface for right-to-left languages such as Persian, Arabic, and Hebrew. Code blocks, diffs, and
				terminals always stay left to right.
			</p>
			{direction === "auto" && (
				<p className="text-xs text-description mt-1">
					Currently rendering {appliedDirection === "rtl" ? "right to left" : "left to right"} from your system
					language.
				</p>
			)}
		</div>
	)
}

export default React.memo(DirectionSetting)
