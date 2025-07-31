import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"
import { FormattedTextField, unlimitedDecimalFormatter } from "../common/FormattedTextField"

interface MaxCostInputProps {
	allowedMaxCost?: number
	onValueChange: (value: number | undefined) => void
}

export function MaxCostInput({ allowedMaxCost, onValueChange }: MaxCostInputProps) {
	const { t } = useTranslation()

	const handleValueChange = useCallback(
		(value: number | undefined) => {
			onValueChange(value)
			vscode.postMessage({ type: "allowedMaxCost", value })
		},
		[onValueChange],
	)

	return (
		<div className="flex flex-col gap-3 pl-3 flex-auto">
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-credit-card" />
				<div>{t("settings:autoApprove.apiCostLimit.title")}</div>
			</div>
			<div className="flex items-center">
				<FormattedTextField
					value={allowedMaxCost}
					onValueChange={handleValueChange}
					formatter={unlimitedDecimalFormatter}
					placeholder={t("settings:autoApprove.apiCostLimit.unlimited")}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-cost-input"
					leftNodes={[<span key="dollar">$</span>]}
				/>
			</div>
		</div>
	)
}
