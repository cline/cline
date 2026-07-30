import type { ChatContent } from "@shared/ChatContent"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/cline/state"
import type { Mode } from "@shared/storage/types"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Plan/Act mode switching for the webview.
 *
 * `togglePlanActModeProto` only resolves after the extension has rebuilt the SDK
 * session for the new mode, which involves aborting any running turn, reloading
 * the conversation, and restarting the session. Rendering the toggle straight
 * from the extension's state snapshot therefore left it visibly lagging the
 * click, so the switch is applied locally first and reconciled with the
 * extension's answer when the RPC settles.
 */
export function useModeSwitch() {
	const { mode, beginModeSwitch } = useExtensionState()

	/**
	 * Switches to `targetMode`, optionally handing the composer's contents over
	 * as the continuation message. Resolves to true when the extension consumed
	 * that content (so the caller should clear the composer).
	 */
	const switchMode = useCallback(
		async (targetMode: Mode, chatContent?: ChatContent): Promise<boolean> => {
			if (targetMode === mode) {
				return false
			}
			const settleModeSwitch = beginModeSwitch(targetMode)
			try {
				const response = await StateServiceClient.togglePlanActModeProto(
					TogglePlanActModeRequest.create({
						mode: targetMode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
						chatContent,
					}),
				)
				return response.value
			} finally {
				settleModeSwitch()
			}
		},
		[mode, beginModeSwitch],
	)

	return { mode, switchMode }
}
