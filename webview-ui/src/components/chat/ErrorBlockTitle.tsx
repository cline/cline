import { TFunction } from "i18next"
import React from "react"
import { ClineError, ClineErrorType } from "../../../../src/services/error/ClineError"
import { ProgressIndicator } from "./ChatRow"

interface ErrorBlockTitleProps {
	cost?: number
	apiReqCancelReason?: string
	apiRequestFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec?: number
		errorSnippet?: string
	}
	// 添加翻译函数作为可选参数
	t?: TFunction<"translation", undefined>
}

export const ErrorBlockTitle = ({
	cost,
	apiReqCancelReason,
	apiRequestFailedMessage,
	retryStatus,
	t,
}: ErrorBlockTitleProps): [React.ReactElement, React.ReactElement] => {
	const getIconSpan = (iconName: string, colorClass: string) => (
		<div className="w-4 h-4 flex items-center justify-center">
			<span className={`codicon codicon-${iconName} text-base -mb-0.5 ${colorClass}`}></span>
		</div>
	)

	const icon =
		apiReqCancelReason != null ? (
			apiReqCancelReason === "user_cancelled" ? (
				getIconSpan("error", "text-(--vscode-descriptionForeground)")
			) : (
				getIconSpan("error", "text-(--vscode-errorForeground)")
			)
		) : cost != null ? (
			getIconSpan("check", "text-(--vscode-charts-green)")
		) : apiRequestFailedMessage ? (
			getIconSpan("error", "text-(--vscode-errorForeground)")
		) : (
			<ProgressIndicator />
		)

	const title = (() => {
		// Default loading state
		const details = {
			title: t?.("error_block_title.api_request", "API Request...") || "API Request...",
			classNames: ["font-bold"],
		}
		// Handle cancellation states first
		if (apiReqCancelReason === "user_cancelled") {
			details.title = t?.("error_block_title.api_request_cancelled", "API Request Cancelled") || "API Request Cancelled"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiReqCancelReason != null) {
			details.title = t?.("error_block_title.api_request_failed", "API Request Failed") || "API Request Failed"
			details.classNames.push("text-(--vscode-errorForeground)")
		} else if (cost != null) {
			// Handle completed request
			details.title = t?.("error_block_title.api_request", "API Request") || "API Request"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiRequestFailedMessage) {
			// Handle failed request
			const clineError = ClineError.parse(apiRequestFailedMessage)
			const titleText = clineError?.isErrorType(ClineErrorType.Balance)
				? t?.("error_block_title.credit_limit_reached", "Credit Limit Reached") || "Credit Limit Reached"
				: t?.("error_block_title.api_request_failed", "API Request Failed") || "API Request Failed"
			details.title = titleText
			details.classNames.push("font-bold text-(--vscode-errorForeground)")
		} else if (retryStatus) {
			// Handle retry state
			details.title = t?.("error_block_title.api_request", "API Request") || "API Request"
			details.classNames.push("text-(--vscode-foreground)")
		}

		return <span className={details.classNames.join(" ")}>{details.title}</span>
	})()

	return [icon, title]
}
