import { SymbolQuery, TypeHierarchyResponse } from "@/shared/proto/index.host"

export async function getTypeHierarchy(_request: SymbolQuery): Promise<TypeHierarchyResponse> {
	throw new Error("PsiService is not available in the VSCode environment.")
}
