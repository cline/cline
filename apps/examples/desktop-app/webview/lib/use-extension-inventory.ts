import {
	fetchExtensionInventory,
	getCachedExtensionInventory,
	subscribeToExtensionInventoryInvalidation,
} from "./extension-inventory";
import { createInventoryResource } from "./inventory-resource";

const resource = createInventoryResource({
	getCached: getCachedExtensionInventory,
	fetch: fetchExtensionInventory,
	subscribeInvalidation: subscribeToExtensionInventoryInvalidation,
});

/** Only a successfully published refresh should trigger follow-up inventory callbacks. */
const refresh = async (force = false) =>
	(await resource.refresh(force)) !== null;

/** One reactive snapshot for installed categories, counts, and mutation responses. */
export function useExtensionInventory() {
	const { data: inventory, loading, error } = resource.useSnapshot();
	return { inventory, loading, error, refresh };
}
