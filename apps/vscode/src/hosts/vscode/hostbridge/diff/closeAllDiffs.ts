import { CloseAllDiffsRequest, CloseAllDiffsResponse } from "@/shared/proto/index.host"

export async function closeAllDiffs(_request: CloseAllDiffsRequest): Promise<CloseAllDiffsResponse> {
	throw new Error("closeAllDiffs is not supported by the VS Code diff service.")
}
