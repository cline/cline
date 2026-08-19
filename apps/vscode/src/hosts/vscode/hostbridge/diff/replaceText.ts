import { ReplaceTextRequest, ReplaceTextResponse } from "@/shared/proto/index.host"

export async function replaceText(_request: ReplaceTextRequest): Promise<ReplaceTextResponse> {
	throw new Error("replaceText is not supported by the VS Code diff service.")
}
