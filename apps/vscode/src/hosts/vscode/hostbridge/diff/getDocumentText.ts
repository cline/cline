import { GetDocumentTextRequest, GetDocumentTextResponse } from "@/shared/proto/index.host"

export async function getDocumentText(_request: GetDocumentTextRequest): Promise<GetDocumentTextResponse> {
	throw new Error("getDocumentText is not supported by the VS Code diff service.")
}
