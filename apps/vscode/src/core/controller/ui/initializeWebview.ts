import { Empty, type EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const state = await controller.getStateToPostToWebview()
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to initialize webview:", error)
		return Empty.create({})
	}
}
