import { GetIndexingStatusRequest, GetIndexingStatusResponse } from "@/shared/proto/index.host"

export async function getIndexingStatus(_request: GetIndexingStatusRequest): Promise<GetIndexingStatusResponse> {
	throw new Error("PsiService is not available in the VSCode environment.")
}
