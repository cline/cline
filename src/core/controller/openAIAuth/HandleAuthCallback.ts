import { Empty } from "@shared/proto/cline/common"
import { AuthCallbackRequest } from "@shared/proto/cline/openai_account"
import { Controller } from "@/core/controller"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"

export async function HandleAuthCallback(_controller: Controller, req: AuthCallbackRequest): Promise<Empty> {
	const { code, state } = req
	await OpenAIAuthService.getInstance().handleAuthCallback(code, state)
	return Empty.create({})
}
