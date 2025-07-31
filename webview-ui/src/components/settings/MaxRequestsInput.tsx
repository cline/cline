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
		<div className="flex flex-col gap-3 pl-3 flex-auto">
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-pulse" />
				<div>{t("settings:autoApprove.apiRequestLimit.title")}</div>
			</div>
			<div className="flex items-center gap-2">
				<FormattedTextField
					value={allowedMaxRequests}
					onValueChange={handleValueChange}
					formatter={unlimitedIntegerFormatter}
					placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-requests-input"
				/>
			</div>
		</div>
	)
}
