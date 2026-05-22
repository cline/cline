import type { EmptyRequest } from "@shared/proto/cline/common"
import { ConnectorCatalogResponse } from "@shared/proto/cline/ui"
import type { Controller } from "../index"

/**
 * RPC handler — fetches the connectors catalog from GitHub Pages and returns it
 * as a JSON string. The webview merges it with its local BUILTIN_CONNECTORS fallback.
 */
export async function refreshConnectorsCatalog(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ConnectorCatalogResponse> {
	try {
		const catalog = await controller.silentlyRefreshConnectorsCatalogRPC()
		return ConnectorCatalogResponse.create({ catalogJson: catalog ?? "[]" })
	} catch (error) {
		console.error("Failed to refresh connectors catalog:", error)
		return ConnectorCatalogResponse.create({ catalogJson: "[]" })
	}
}
