import { useMemo } from "react"

interface AutoApprovalToggles {
	alwaysAllowReadOnly?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowExecute?: boolean
	alwaysAllowBrowser?: boolean
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysApproveResubmit?: boolean
	alwaysAllowFollowupQuestions?: boolean
	alwaysAllowUpdateTodoList?: boolean
}

export function useAutoApprovalState(toggles: AutoApprovalToggles, autoApprovalEnabled?: boolean) {
	const hasEnabledOptions = useMemo(() => {
		return Object.values(toggles).some((value) => !!value)
	}, [toggles])

	const effectiveAutoApprovalEnabled = useMemo(() => {
		return autoApprovalEnabled ?? false
	}, [autoApprovalEnabled])

	return {
		hasEnabledOptions,
		effectiveAutoApprovalEnabled,
	}
}
