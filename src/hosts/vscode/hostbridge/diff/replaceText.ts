import { ReplaceTextRequest, ReplaceTextResponse } from "@/shared/proto/index.host"

export async function replaceText(_request: ReplaceTextRequest): Promise<ReplaceTextResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
