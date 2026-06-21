import { Empty } from "@/shared/proto/cline/common"
import { CommitModelSelectionRequest } from "@/shared/proto/cline/models"
import { type ProviderCatalogController } from "./providerCatalogShared"

export async function commitModelSelection(
	_controller: ProviderCatalogController,
	_request: CommitModelSelectionRequest,
): Promise<Empty> {
	return Empty.create()
}
