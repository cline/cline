import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { Controller } from "@/core/controller"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"

export async function CreateAuthRequest(_controller: Controller, _req: EmptyRequest): Promise<ProtoString> {
	return await OpenAIAuthService.getInstance().createAuthRequest()
}
