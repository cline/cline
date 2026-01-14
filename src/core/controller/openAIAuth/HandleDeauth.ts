import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "@/core/controller"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"
import { LogoutReason } from "@/services/auth/types"
import { Logger } from "@/shared/services/Logger"

export async function HandleDeauth(_controller: Controller, _req: EmptyRequest): Promise<Empty> {
	try {
		await OpenAIAuthService.getInstance().handleDeauth(LogoutReason.USER_INITIATED)
	} catch (error) {
		Logger.error("Error handling OpenAI deauth:", error)
	}
	return Empty.create({})
}
