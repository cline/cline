import { TruncateDocumentRequest, TruncateDocumentResponse } from "@/shared/proto/index.host"

export async function truncateDocument(_request: TruncateDocumentRequest): Promise<TruncateDocumentResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
