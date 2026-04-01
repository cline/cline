import { SearchSymbolsRequest, SymbolQueryResponse } from "@/shared/proto/index.host"

export async function searchSymbols(_request: SearchSymbolsRequest): Promise<SymbolQueryResponse> {
	throw new Error("PsiService is not available in the VSCode environment.")
}
