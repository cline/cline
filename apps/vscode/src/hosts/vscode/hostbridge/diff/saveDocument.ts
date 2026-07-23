import { SaveDocumentRequest, SaveDocumentResponse } from "@/shared/proto/index.host"

export async function saveDocument(_request: SaveDocumentRequest): Promise<SaveDocumentResponse> {
	throw new Error("saveDocument is not supported by the VS Code diff service.")
}
