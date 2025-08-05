import { GetDocumentTextRequest, GetDocumentTextResponse } from "@/shared/proto/index.host"

export async function getDocumentText(_request: GetDocumentTextRequest): Promise<GetDocumentTextResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
