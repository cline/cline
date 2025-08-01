import React from "react"
import { useTranslation } from "react-i18next"
import { MaxRequestsInput } from "./MaxRequestsInput"
import { MaxCostInput } from "./MaxCostInput"

export interface MaxLimitInputsProps {
	allowedMaxRequests?: number
	allowedMaxCost?: number
	onMaxRequestsChange: (value: number | undefined) => void
	onMaxCostChange: (value: number | undefined) => void
}

export const MaxLimitInputs: React.FC<MaxLimitInputsProps> = ({
	allowedMaxRequests,
	allowedMaxCost,
	onMaxRequestsChange,
	onMaxCostChange,
}) => {
	const { t } = useTranslation()

	return (
		<div className="space-y-2">
			<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 items-center">
				<MaxRequestsInput allowedMaxRequests={allowedMaxRequests} onValueChange={onMaxRequestsChange} />
				<MaxCostInput allowedMaxCost={allowedMaxCost} onValueChange={onMaxCostChange} />
			</div>
			<div className="text-xs text-vscode-descriptionForeground">
				{t("settings:autoApprove.maxLimits.description")}
			</div>
		</div>
	)
}
