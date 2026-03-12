import type { ExtensionState } from "@shared/ExtensionMessage"
import deepEqual from "fast-deep-equal"

export function mergeExtensionStateSnapshot(prevState: ExtensionState, incomingState: ExtensionState): ExtensionState {
	const incomingVersion = incomingState.autoApprovalSettings?.version ?? 1
	const currentVersion = prevState.autoApprovalSettings?.version ?? 1
	const shouldUpdateAutoApproval = incomingVersion > currentVersion

	const nextClineMessages =
		incomingState.currentTaskItem?.id === prevState.currentTaskItem?.id
			? incomingState.clineMessages?.length
				? incomingState.clineMessages
				: prevState.clineMessages
			: incomingState.clineMessages

	const newState = {
		...incomingState,
		clineMessages: nextClineMessages,
		autoApprovalSettings: shouldUpdateAutoApproval ? incomingState.autoApprovalSettings : prevState.autoApprovalSettings,
	}

	return deepEqual(newState, prevState) ? prevState : newState
}
