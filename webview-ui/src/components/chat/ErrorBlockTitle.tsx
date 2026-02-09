import React from "react"
import { BeadsmithError, BeadsmithErrorType } from "../../../../src/services/error/BeadsmithError"
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
}

export const ErrorBlockTitle = ({
	cost,
	apiReqCancelReason,
	apiRequestFailedMessage,
	retryStatus,
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
		const details = { title: "API Request...", classNames: ["font-bold"] }
		// Handle cancellation states first
		if (apiReqCancelReason === "user_cancelled") {
			details.title = "API Request Cancelled"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiReqCancelReason != null) {
			details.title = "API Request Failed"
			details.classNames.push("text-(--vscode-errorForeground)")
		} else if (cost != null) {
			// Handle completed request
			details.title = "API Request"
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiRequestFailedMessage) {
			// Handle failed request
			const beadsmithError = BeadsmithError.parse(apiRequestFailedMessage)
			const titleText = beadsmithError?.isErrorType(BeadsmithErrorType.Balance)
				? "Credit Limit Reached"
				: "API Request Failed"
			details.title = titleText
			details.classNames.push("font-bold text-(--vscode-errorForeground)")
		} else if (retryStatus) {
			// Handle retry state
			details.title = "API Request"
			details.classNames.push("text-(--vscode-foreground)")
		}

		return <span className={details.classNames.join(" ")}>{details.title}</span>
	})()

	return [icon, title]
}
