import { CloseAllDiffsRequest, CloseAllDiffsResponse } from "@/shared/proto/index.host"

export async function closeAllDiffs(_request: CloseAllDiffsRequest): Promise<CloseAllDiffsResponse> {
	throw new Error("diffService is not supported. Use the VscodeDiffViewProvider.")
}
