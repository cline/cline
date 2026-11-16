import {
	fetchMcpServers,
	getCachedMcpServers,
	subscribeToExtensionInventoryInvalidation,
} from "./extension-inventory";
import { createInventoryResource } from "./inventory-resource";

const resource = createInventoryResource({
	getCached: getCachedMcpServers,
	fetch: fetchMcpServers,
	subscribeInvalidation: subscribeToExtensionInventoryInvalidation,
});

/** MCP cards, editors, and headless counts observe the same response and read status. */
export function useMcpInventory() {
	const { data: response, loading, error } = resource.useSnapshot();
	return { response, loading, error, refresh: resource.refresh };
}
