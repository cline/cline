import {
	PlanActMode,
	TogglePlanActModeRequest,
	TogglePlanActModeResponse,
} from "@shared/proto/cline/state";
import { Mode } from "@shared/storage/types";
import { Logger } from "@/shared/services/Logger";
import { Controller } from "..";

/**
 * Toggles between Plan and Act modes
 * @param controller The controller instance
 * @param request The request containing the chat settings and optional chat content
 * @returns Response with forwarded status and returned message
 */
export async function togglePlanActModeProto(
	controller: Controller,
	request: TogglePlanActModeRequest,
): Promise<TogglePlanActModeResponse> {
	try {
		let mode: Mode;
		if (request.mode === PlanActMode.PLAN) {
			mode = "plan";
		} else if (request.mode === PlanActMode.ACT) {
			mode = "act";
		} else {
			throw new Error(`Invalid mode value: ${request.mode}`);
		}
		const chatContent = request.chatContent;

		// Call the existing controller implementation
		const wasForwarded = await controller.togglePlanActMode(mode, chatContent);

		if (wasForwarded) {
			// Message was forwarded to task, clear the input
			return TogglePlanActModeResponse.create({
				forwarded: true,
				returnedMessage: "",
			});
		} else {
			// Message was not forwarded, return it to the input
			return TogglePlanActModeResponse.create({
				forwarded: false,
				returnedMessage: chatContent?.message ?? "",
			});
		}
	} catch (error) {
		Logger.error("Failed to toggle Plan/Act mode:", error);
		throw error;
	}
}
