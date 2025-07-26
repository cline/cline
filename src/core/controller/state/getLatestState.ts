import * as vscode from "vscode"
import { Controller } from "../index"
import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"

/**
 * Get the latest extension state
 * @param controller The controller instance
 * @param request The empty request
 * @returns The current extension state
 */
export async function getLatestState(controller: Controller, _: EmptyRequest): Promise<State> {
	// Get the state using the existing method
	const state = await controller.getStateToPostToWebview()

	// Convert the state to a JSON string
	const stateJson = JSON.stringify(state)

	// Return the state as a JSON string
	return State.create({
		stateJson,
	})
}
