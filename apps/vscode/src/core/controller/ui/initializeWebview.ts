import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Initialize webview when it launches.
 *
 * Pushes the current state snapshot to the webview so it hydrates on connect. State is sent
 * through the Controller's WebviewBridge (the state stream must already be registered via
 * subscribeToState). Returns Empty.
 */
export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("Error initializing webview:", error)
	}
	return Empty.create({})
}
