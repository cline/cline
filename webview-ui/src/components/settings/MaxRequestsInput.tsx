import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"
import { FormattedTextField, unlimitedIntegerFormatter } from "../common/FormattedTextField"

interface MaxRequestsInputProps {
	allowedMaxRequests?: number
	onValueChange: (value: number | undefined) => void
}

export function MaxRequestsInput({ allowedMaxRequests, onValueChange }: MaxRequestsInputProps) {
	const { t } = useTranslation()

	const handleValueChange = useCallback(
		(value: number | undefined) => {
			onValueChange(value)
			vscode.postMessage({ type: "allowedMaxRequests", value })
		},
		[onValueChange],
	)

	return (
		<>
			<label className="flex items-center gap-2 text-sm font-medium whitespace-nowrap">
				<span className="codicon codicon-pulse" />
				{t("settings:autoApprove.apiRequestLimit.title")}:
			</label>
			<FormattedTextField
				value={allowedMaxRequests}
				onValueChange={handleValueChange}
				formatter={unlimitedIntegerFormatter}
				placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
				style={{ maxWidth: "200px" }}
				data-testid="max-requests-input"
			/>
		</>
	)
}
