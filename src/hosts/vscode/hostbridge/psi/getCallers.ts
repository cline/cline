import { SymbolQuery, SymbolQueryResponse } from "@/shared/proto/index.host"

export async function getCallers(_request: SymbolQuery): Promise<SymbolQueryResponse> {
	throw new Error("PsiService is not available in the VSCode environment.")
}
