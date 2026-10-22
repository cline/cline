import { TruncateDocumentRequest, TruncateDocumentResponse } from "@/shared/proto/index.host"

export async function truncateDocument(_request: TruncateDocumentRequest): Promise<TruncateDocumentResponse> {
	throw new Error("truncateDocument is not supported by the VS Code diff service.")
}
