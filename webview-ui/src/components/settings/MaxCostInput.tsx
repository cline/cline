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
		<>
			<label className="flex items-center gap-2 text-sm font-medium whitespace-nowrap">
				<span className="codicon codicon-credit-card" />
				{t("settings:autoApprove.apiCostLimit.title")}:
			</label>
			<FormattedTextField
				value={allowedMaxCost}
				onValueChange={handleValueChange}
				formatter={unlimitedDecimalFormatter}
				placeholder={t("settings:autoApprove.apiCostLimit.unlimited")}
				style={{ maxWidth: "200px" }}
				data-testid="max-cost-input"
				leftNodes={[<span key="dollar">$</span>]}
			/>
		</>
	)
}
